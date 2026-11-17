import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { embedTexts, generateJson, isAiAvailable } from '../ai/client.js';
import { ASK_SYSTEM, askSchema } from '../ai/prompts.js';
import { rankCandidates } from '../lib/similarity.js';
import { docWhere, type Viewer } from '../access.js';

/** Passages sent to the model. Enough to cover a fact spread over two places, small enough to stay fast. */
const TOP_PASSAGES = 8;
const MAX_SOURCES = 6;
const EXCERPT = 1200;

interface Passage {
  docId: string;
  text: string;
  vector: number[];
}

/**
 * "Ask Relay": retrieval-augmented answers over the knowledge base (documents, uploaded files, past meetings).
 *
 * 1. Retrieval only searches documents this user may see, so the model can't be handed anything private.
 * 2. It ranks PASSAGES, not whole documents: a long uploaded PDF is split into ~1,200-character chunks,
 *    each with its own embedding, so the answer can come from page 20, not just the first page.
 *    Documents without chunks (past meetings) count as one passage.
 * 3. The model must cite the documents it used; any citation we didn't send is dropped, and an answer
 *    with no valid citation is reported as "not found" rather than shown as fact.
 */
export async function ask(question: string, viewer: Viewer) {
  const docs = await prisma.knowledgeDoc.findMany({
    where: docWhere(viewer),
    select: {
      id: true,
      title: true,
      content: true,
      source: true,
      sessionId: true,
      fileName: true,
      embedding: true,
      createdAt: true,
      session: { select: { scheduledAt: true } },
      chunks: { select: { text: true, embedding: true }, orderBy: { index: 'asc' } },
    },
  });
  // A meeting's knowledge is dated by when the meeting happened, not when its doc row was written.
  // The model needs real dates to prefer the latest decision when documents disagree.
  const dated = (d: (typeof docs)[number]) => (d.session?.scheduledAt ?? d.createdAt).toISOString().slice(0, 10);

  const passages: Passage[] = docs.flatMap((d) =>
    d.chunks.length
      ? d.chunks.map((c) => ({ docId: d.id, text: c.text, vector: c.embedding }))
      : [{ docId: d.id, text: d.content.slice(0, EXCERPT), vector: d.embedding }],
  );
  const byId = new Map(docs.map((d) => [d.id, d]));
  const [qVector] = (await embedTexts('ask.embed_question', [question])) ?? [null];
  const top = rankCandidates({ text: question, vector: qVector }, passages, (p) => ({ text: `${byId.get(p.docId)!.title} ${p.text}`, vector: p.vector }), TOP_PASSAGES).map(
    (r) => r.item,
  );

  // Group the winning passages by document, keeping the best-ranked documents first.
  const groups = new Map<string, string[]>();
  for (const p of top) groups.set(p.docId, [...(groups.get(p.docId) ?? []), p.text]);
  const topDocs = [...groups.keys()].slice(0, MAX_SOURCES).map((id) => byId.get(id)!);
  const sources = topDocs.map((d) => ({ id: d.id, title: d.title, source: d.source, sessionId: d.sessionId, fileName: d.fileName }));

  if (topDocs.length === 0) {
    logger.info({ event: 'ask.answered', mode: 'none', candidates: 0 }, 'ask: nothing relevant');
    return { mode: 'none' as const, answer: null, citations: [], sources: [] };
  }
  if (!isAiAvailable()) {
    logger.info({ event: 'ask.answered', mode: 'search', candidates: topDocs.length }, 'ask: AI off, returning matches');
    return { mode: 'search' as const, answer: null, citations: [], sources };
  }

  const prompt = JSON.stringify({
    question,
    documents: topDocs
      .map((d) => ({ docId: d.id, title: d.title, date: dated(d), passages: groups.get(d.id)! }))
      .sort((a, b) => a.date.localeCompare(b.date)), // oldest first, so "latest" is unambiguous
  });
  try {
    const res = await generateJson('ask.answer', askSchema, ASK_SYSTEM, prompt, { cacheTtlMs: 10 * 60_000 });
    const sent = new Set(topDocs.map((d) => d.id));
    const citations = [...new Set(res.citations.filter((id) => sent.has(id)))];
    const dropped = res.citations.length - citations.length;
    if (dropped) logger.warn({ event: 'ask.citation_filtered', dropped }, 'dropped citations to documents that were not provided');
    const found = res.found && citations.length > 0;
    logger.info({ event: 'ask.answered', mode: 'ai', found, citations: citations.length, passages: top.length }, 'ask answered');
    return {
      mode: 'ai' as const,
      answer: found ? res.answer : null,
      citations: found ? sources.filter((s) => citations.includes(s.id)) : [],
      sources,
    };
  } catch {
    return { mode: 'search' as const, answer: null, citations: [], sources };
  }
}
