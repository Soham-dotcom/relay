import { prisma } from '../db.js';
import { notFound } from '../errors.js';
import { logger } from '../logger.js';
import { embedTexts, generateJson, isAiAvailable } from '../ai/client.js';
import { LINK_SYSTEM, linkSchema } from '../ai/prompts.js';
import { rankCandidates } from '../lib/similarity.js';

const SNIPPET = 500;
const CANDIDATES_PER_TARGET = 4;
/** Below this, an automatic (non-AI) match is too weak to show. */
const FALLBACK_MIN_SCORE = 0.35;

export async function createDoc(title: string, content: string) {
  const [vector] = (await embedTexts('kb.embed_doc', [`${title}\n${content}`])) ?? [[]];
  const doc = await prisma.knowledgeDoc.create({ data: { title, content, embedding: vector } });
  logger.info({ event: 'kb.doc_created', docId: doc.id, embedded: vector.length > 0 }, 'knowledge doc created');
  return doc;
}

export async function deleteDoc(id: string) {
  const doc = await prisma.knowledgeDoc.findUnique({ where: { id } });
  if (!doc) throw notFound('Document');
  await prisma.knowledgeDoc.delete({ where: { id } });
  logger.info({ event: 'kb.doc_deleted', docId: id }, 'knowledge doc deleted');
}

export function listDocs(q?: string) {
  return prisma.knowledgeDoc.findMany({
    where: q
      ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }] }
      : undefined,
    select: {
      id: true,
      title: true,
      content: true,
      source: true,
      sessionId: true,
      createdAt: true,
      links: {
        include: {
          item: { select: { id: true, title: true, status: true } },
          decision: { select: { id: true, text: true, sessionId: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Turns a held session into a knowledge doc, so later meetings can be linked to it. */
export async function indexSession(sessionId: string) {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { decisions: true, items: { include: { owner: true } } },
  });
  if (!s) throw notFound('Session');
  const content = [
    `${s.kind === 'TRANSFER' ? 'Work transfer' : 'Meeting'} on ${s.scheduledAt.toISOString().slice(0, 10)}`,
    s.summary ? `Summary: ${s.summary}` : '',
    s.decisions.length ? `Decisions:\n${s.decisions.map((d) => `- ${d.text}`).join('\n')}` : '',
    s.items.length ? `Action items:\n${s.items.map((i) => `- ${i.title} (${i.owner?.name ?? 'unassigned'}, ${i.status})`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const [vector] = (await embedTexts('kb.embed_session', [`${s.title}\n${content}`])) ?? [[]];
  await prisma.knowledgeDoc.upsert({
    where: { sessionId },
    create: { title: s.title, content, source: 'MEETING', sessionId, embedding: vector },
    update: { title: s.title, content, embedding: vector },
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
 */
export async function linkToKnowledge(targets: LinkTarget[], excludeSessionId?: string) {
  if (targets.length === 0) return { created: 0, mode: 'none' as const };
  const docs = await prisma.knowledgeDoc.findMany({
    where: excludeSessionId ? { OR: [{ sessionId: null }, { sessionId: { not: excludeSessionId } }] } : undefined,
  });
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
