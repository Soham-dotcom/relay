import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { embedTexts, generateJson, isAiAvailable } from '../ai/client.js';
import { ASK_SYSTEM, askSchema } from '../ai/prompts.js';
import { rankCandidates } from '../lib/similarity.js';
import { docWhere, type Viewer } from '../access.js';

const TOP_K = 6;
const EXCERPT = 1200;

/**
 * "Ask Relay": retrieval-augmented answers over the knowledge base (documents + past meetings).
 * Retrieval only ever searches documents this user may see, so the model can't be handed anything
 * private. The model must cite the documents it used; any citation we didn't send is dropped, and
 * an answer with no valid citation is reported as "not found" rather than shown as fact.
 */
export async function ask(question: string, viewer: Viewer) {
  const docs = await prisma.knowledgeDoc.findMany({
    where: docWhere(viewer),
    select: { id: true, title: true, content: true, source: true, sessionId: true, embedding: true, createdAt: true, session: { select: { scheduledAt: true } } },
  });
  // A meeting's knowledge is dated by when the meeting happened, not when its doc row was written.
  // The model needs real dates to prefer the latest decision when documents disagree.
  const dated = (d: (typeof docs)[number]) => (d.session?.scheduledAt ?? d.createdAt).toISOString().slice(0, 10);
  const [qVector] = (await embedTexts('ask.embed_question', [question])) ?? [null];
  const top = rankCandidates({ text: question, vector: qVector }, docs, (d) => ({ text: `${d.title} ${d.content}`, vector: d.embedding }), TOP_K).map((r) => r.item);
  const sources = top.map((d) => ({ id: d.id, title: d.title, source: d.source, sessionId: d.sessionId }));

  if (top.length === 0) {
    logger.info({ event: 'ask.answered', mode: 'none', candidates: 0 }, 'ask: nothing relevant');
    return { mode: 'none' as const, answer: null, citations: [], sources: [] };
  }
  if (!isAiAvailable()) {
    logger.info({ event: 'ask.answered', mode: 'search', candidates: top.length }, 'ask: AI off, returning matches');
    return { mode: 'search' as const, answer: null, citations: [], sources };
  }

  const prompt = JSON.stringify({
    question,
    documents: top
      .map((d) => ({ docId: d.id, title: d.title, date: dated(d), text: d.content.slice(0, EXCERPT) }))
      .sort((a, b) => a.date.localeCompare(b.date)), // oldest first, so "latest" is unambiguous
  });
  try {
    const res = await generateJson('ask.answer', askSchema, ASK_SYSTEM, prompt);
    const sent = new Set(top.map((d) => d.id));
    const citations = [...new Set(res.citations.filter((id) => sent.has(id)))];
    const dropped = res.citations.length - citations.length;
    if (dropped) logger.warn({ event: 'ask.citation_filtered', dropped }, 'dropped citations to documents that were not provided');
    const found = res.found && citations.length > 0;
    logger.info({ event: 'ask.answered', mode: 'ai', found, citations: citations.length }, 'ask answered');
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
