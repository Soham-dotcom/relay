import type { Visibility } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { embedTexts, generateJson, isAiAvailable } from '../ai/client.js';
import { LINK_SYSTEM, linkSchema } from '../ai/prompts.js';
import { rankCandidates } from '../lib/similarity.js';
import { chunkText } from '../lib/chunk.js';
import {
  covers,
  docAudience,
  docWhere,
  itemWhere,
  loadDirectory,
  loadSessionScope,
  scopeInclude,
  sessionAudience,
  sessionWhere,
  toScope,
  type Viewer,
} from '../access.js';

const SNIPPET = 500;
const CANDIDATES_PER_TARGET = 4;
/** Below this, an automatic (non-AI) match is too weak to show. */
const FALLBACK_MIN_SCORE = 0.35;

/** How much of a long document goes into its single doc-level vector (used for linking). */
const DOC_VECTOR_CHARS = 6000;
/** Embedding requests are batched; this keeps each request well under the provider's limit. */
const EMBED_BATCH = 50;

export interface NewDoc {
  title: string;
  content: string;
  visibility: Visibility;
  teamId?: string | null;
  fileName?: string;
  fileType?: string;
}

export async function createDoc(input: NewDoc, viewer: Viewer) {
  if (input.visibility === 'TEAM' && !input.teamId) throw new AppError(400, 'TEAM_REQUIRED', 'Choose the team this document belongs to');
  if (input.teamId && !viewer.teamIds.includes(input.teamId)) throw new AppError(400, 'INVALID_TEAM', 'You can only add documents for a team you belong to');
  const [vector] = (await embedTexts('kb.embed_doc', [`${input.title}\n${input.content.slice(0, DOC_VECTOR_CHARS)}`])) ?? [[]];
  const doc = await prisma.knowledgeDoc.create({
    data: {
      title: input.title,
      content: input.content,
      visibility: input.visibility,
      teamId: input.visibility === 'TEAM' ? input.teamId : null,
      createdById: viewer.id,
      fileName: input.fileName,
      fileType: input.fileType,
      embedding: vector,
    },
  });
  const chunks = await indexChunks(doc.id, input.title, input.content);
  logger.info(
    { event: 'kb.doc_created', docId: doc.id, visibility: doc.visibility, fileType: input.fileType ?? 'text', chars: input.content.length, chunks: chunks.count, embedded: chunks.embedded },
    'knowledge doc created',
  );
  return { ...doc, chunks: chunks.count };
}

/**
 * Splits a document into passages and embeds each one, so Ask can find the right part of a long file.
 * Embeddings are best-effort: if they fail, the passages are still stored and found by keyword search.
 */
export async function indexChunks(docId: string, title: string, content: string) {
  const parts = chunkText(content);
  let embedded = 0;
  const rows: { docId: string; index: number; text: string; embedding: number[] }[] = [];
  for (let i = 0; i < parts.length; i += EMBED_BATCH) {
    const batch = parts.slice(i, i + EMBED_BATCH);
    // The title is prepended so a passage like "It must be approved by the lead" still knows what "it" is.
    const vectors = await embedTexts('kb.embed_chunks', batch.map((p) => `${title}\n${p}`));
    batch.forEach((text, j) => {
      const embedding = vectors?.[j] ?? [];
      if (embedding.length) embedded++;
      rows.push({ docId, index: i + j, text, embedding });
    });
  }
  await prisma.docChunk.deleteMany({ where: { docId } });
  if (rows.length) await prisma.docChunk.createMany({ data: rows });
  return { count: rows.length, embedded };
}

export async function deleteDoc(id: string) {
  await prisma.knowledgeDoc.delete({ where: { id } });
  logger.info({ event: 'kb.doc_deleted', docId: id }, 'knowledge doc deleted');
}

/** A long uploaded file can be hundreds of KB; the list only needs a preview. */
const PREVIEW_CHARS = 700;

export async function listDocs(q: string | undefined, viewer: Viewer) {
  const docs = await prisma.knowledgeDoc.findMany({
    where: {
      AND: [
        docWhere(viewer),
        q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }] } : {},
      ],
    },
    select: {
      id: true,
      title: true,
      content: true,
      source: true,
      visibility: true,
      team: { select: { id: true, name: true } },
      sessionId: true,
      createdAt: true,
      fileName: true,
      fileType: true,
      _count: { select: { chunks: true } },
      // An org-wide doc can be linked to a team decision; only show links to things this viewer can see.
      links: {
        where: { OR: [{ item: itemWhere(viewer) }, { decision: { session: sessionWhere(viewer) } }] },
        include: {
          item: { select: { id: true, title: true, status: true } },
          decision: { select: { id: true, text: true, sessionId: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return docs.map(({ content, _count, ...d }) => ({
    ...d,
    content: content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}…` : content,
    chars: content.length,
    chunks: _count.chunks,
  }));
}

/** Turns a held session into a knowledge doc, so later meetings can be linked to it. Access follows the session. */
export async function indexSession(sessionId: string) {
  const s = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { decisions: true, items: { include: { owner: true } } },
  });
  const content = [
    `${s.kind === 'TRANSFER' ? 'Work transfer' : 'Meeting'} on ${s.scheduledAt.toISOString().slice(0, 10)}`,
    s.summary ? `Summary: ${s.summary}` : '',
    s.decisions.length ? `Decisions:\n${s.decisions.map((d) => `- ${d.text}`).join('\n')}` : '',
    s.items.length ? `Action items:\n${s.items.map((i) => `- ${i.title} (${i.owner?.name ?? 'unassigned'}, ${i.status})`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const [vector] = (await embedTexts('kb.embed_session', [`${s.title}\n${content}`])) ?? [[]];
  const scope = { title: s.title, content, embedding: vector, visibility: s.visibility, teamId: s.teamId };
  await prisma.knowledgeDoc.upsert({
    where: { sessionId },
    create: { ...scope, source: 'MEETING', sessionId, createdById: s.createdById },
    update: scope,
  });
}

export interface LinkTarget {
  kind: 'item' | 'decision';
  id: string;
  text: string;
}

/**
 * Two stages: cheap retrieval (embeddings, or keywords when embeddings fail) picks a few candidate
 * docs per target, then the model keeps only the useful ones and explains why. The model can only
 * choose among the candidates we gave it; any other id is dropped.
 *
 * Candidates are limited to docs that everyone who can see the session can also see. Otherwise a
 * private doc's title and the AI's reason would show up on a team-wide item.
 */
export async function linkToKnowledge(targets: LinkTarget[], sessionId: string) {
  if (targets.length === 0) return { created: 0, mode: 'none' as const };
  const [dir, scope, allDocs] = await Promise.all([
    loadDirectory(),
    loadSessionScope(sessionId),
    prisma.knowledgeDoc.findMany({
      where: { OR: [{ sessionId: null }, { sessionId: { not: sessionId } }] },
      include: { session: { select: { visibility: true, teamId: true, ...scopeInclude } } },
    }),
  ]);
  const audience = sessionAudience(scope, dir);
  const docs = allDocs.filter((d) => covers(docAudience({ ...d, session: d.session ? toScope(d.session) : null }, dir), audience));
  if (allDocs.length !== docs.length) logger.info({ event: 'kb.link_scoped', sessionId, hidden: allDocs.length - docs.length }, 'docs outside the audience excluded from linking');
  if (docs.length === 0) return { created: 0, mode: 'none' as const };

  const vectors = await embedTexts('kb.embed_targets', targets.map((t) => t.text));
  const candidates = targets.map((t, i) => ({
    target: t,
    docs: rankCandidates({ text: t.text, vector: vectors?.[i] ?? null }, docs, (d) => ({ text: `${d.title} ${d.content}`, vector: d.embedding }), CANDIDATES_PER_TARGET),
  }));

  let links: { targetId: string; docId: string; reason: string; score: number }[] = [];
  let mode: 'ai' | 'fallback' = 'ai';

  if (isAiAvailable()) {
    try {
      const prompt = JSON.stringify(
        candidates
          .filter((c) => c.docs.length)
          .map((c) => ({
            targetId: c.target.id,
            target: `${c.target.kind}: ${c.target.text}`,
            candidates: c.docs.map((d) => ({ docId: d.item.id, title: d.item.title, excerpt: d.item.content.slice(0, SNIPPET) })),
          })),
      );
      const res = await generateJson('kb.link', linkSchema, LINK_SYSTEM, prompt);
      const allowed = new Map(candidates.map((c) => [c.target.id, new Set(c.docs.map((d) => d.item.id))]));
      links = res.links
        .filter((l) => allowed.get(l.targetId)?.has(l.docId) && l.relevance >= 0.5)
        .map((l) => ({ targetId: l.targetId, docId: l.docId, reason: l.reason, score: l.relevance }));
      const dropped = res.links.length - links.length;
      if (dropped) logger.warn({ event: 'kb.link_filtered', dropped }, 'dropped AI links with unknown ids or low relevance');
    } catch {
      mode = 'fallback';
    }
  } else mode = 'fallback';

  if (mode === 'fallback') {
    links = candidates.flatMap((c) =>
      c.docs
        .filter((d) => d.score >= FALLBACK_MIN_SCORE)
        .slice(0, 2)
        .map((d) => ({ targetId: c.target.id, docId: d.item.id, reason: 'Automatic match on similar wording (AI was unavailable).', score: d.score })),
    );
  }

  const kindOf = new Map(targets.map((t) => [t.id, t.kind]));
  let created = 0;
  for (const l of links) {
    const isItem = kindOf.get(l.targetId) === 'item';
    const where = isItem ? { docId_itemId: { docId: l.docId, itemId: l.targetId } } : { docId_decisionId: { docId: l.docId, decisionId: l.targetId } };
    await prisma.knowledgeLink.upsert({
      where,
      create: { docId: l.docId, reason: l.reason, score: l.score, ...(isItem ? { itemId: l.targetId } : { decisionId: l.targetId }) },
      update: { reason: l.reason, score: l.score },
    });
    created++;
  }
  logger.info({ event: 'kb.linked', targets: targets.length, links: created, mode }, 'knowledge links created');
  return { created, mode };
}
