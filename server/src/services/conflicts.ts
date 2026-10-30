import type { ConflictStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { conflictWhere, covers, loadDirectory, loadSessionScope, scopeInclude, sessionAudience, toScope, type Viewer } from '../access.js';
import { embedTexts, generateJson, isAiAvailable } from '../ai/client.js';
import { CONFLICT_SYSTEM, conflictSchema } from '../ai/prompts.js';
import { rankCandidates } from '../lib/similarity.js';

const PAST_PER_DECISION = 5;
const MIN_CONFIDENCE = 0.6;

const conflictInclude = {
  decision: { include: { session: { select: { id: true, title: true, scheduledAt: true } } } },
  pastDecision: { include: { session: { select: { id: true, title: true, scheduledAt: true } } } },
} as const;

/**
 * Special feature. For each new decision: find the most related earlier decisions (embeddings,
 * keyword fallback), then ask the model whether any pair actually contradicts. Only pairs we sent
 * can come back, and only confident ones are stored. Without AI we store nothing rather than guess:
 * a false "conflict" would do more harm than a missed one.
 */
export async function checkConflicts(sessionId: string) {
  const fresh = await prisma.decision.findMany({ where: { sessionId } });
  if (fresh.length === 0) return { found: 0, checked: false };
  if (!isAiAvailable()) {
    logger.warn({ event: 'conflicts.skipped', sessionId }, 'conflict check skipped: AI unavailable');
    return { found: 0, checked: false };
  }
  // Only compare with earlier decisions that everyone who can see this session can also see;
  // otherwise the explanation would quote a private decision to people outside it.
  const [dir, scope, allPast] = await Promise.all([
    loadDirectory(),
    loadSessionScope(sessionId),
    prisma.decision.findMany({
      where: { sessionId: { not: sessionId } },
      include: { session: { select: { title: true, scheduledAt: true, visibility: true, teamId: true, ...scopeInclude } } },
    }),
  ]);
  const audience = sessionAudience(scope, dir);
  const past = allPast.filter((p) => covers(sessionAudience(toScope(p.session), dir), audience));
  if (allPast.length !== past.length) logger.info({ event: 'conflicts.scoped', sessionId, hidden: allPast.length - past.length }, 'decisions outside the audience excluded');
  if (past.length === 0) return { found: 0, checked: true };

  const vectors = await embedTexts('conflicts.embed', [...fresh, ...past].map((d) => d.text));
  const vecOf = (i: number) => vectors?.[i] ?? [];
  const pairs = fresh.map((d, i) => ({
    decision: d,
    related: rankCandidates({ text: d.text, vector: vectors ? vecOf(i) : null }, past.map((p, j) => ({ p, v: vecOf(fresh.length + j) })), (x) => ({ text: x.p.text, vector: x.v }), PAST_PER_DECISION).map((r) => r.item.p),
  }));
  const toCheck = pairs.filter((p) => p.related.length);
  if (toCheck.length === 0) return { found: 0, checked: true };

  const prompt = JSON.stringify(
    toCheck.map((p) => ({
      decisionId: p.decision.id,
      newDecision: p.decision.text,
      earlierDecisions: p.related.map((r) => ({ pastDecisionId: r.id, text: r.text, from: `${r.session.title} (${r.session.scheduledAt.toISOString().slice(0, 10)})` })),
    })),
  );
  const res = await generateJson('conflicts.check', conflictSchema, CONFLICT_SYSTEM, prompt);
  const allowed = new Map(toCheck.map((p) => [p.decision.id, new Set(p.related.map((r) => r.id))]));
  const kept = res.conflicts.filter((c) => allowed.get(c.decisionId)?.has(c.pastDecisionId) && c.confidence >= MIN_CONFIDENCE);

  for (const c of kept) {
    await prisma.decisionConflict.upsert({
      where: { decisionId_pastDecisionId: { decisionId: c.decisionId, pastDecisionId: c.pastDecisionId } },
      create: { decisionId: c.decisionId, pastDecisionId: c.pastDecisionId, explanation: c.explanation, confidence: c.confidence },
      update: { explanation: c.explanation, confidence: c.confidence },
    });
    logger.info({ event: 'conflict.detected', decisionId: c.decisionId, pastDecisionId: c.pastDecisionId, confidence: c.confidence }, 'decision conflict detected');
  }
  return { found: kept.length, checked: true };
}

export function listConflicts(status: ConflictStatus | undefined, viewer: Viewer) {
  return prisma.decisionConflict.findMany({
    where: { ...(status ? { status } : {}), AND: [conflictWhere(viewer)] },
    include: conflictInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function resolveConflict(id: string, status: ConflictStatus, resolution?: string) {
  const updated = await prisma.decisionConflict.update({ where: { id }, data: { status, resolution }, include: conflictInclude });
  logger.info({ event: 'conflict.updated', conflictId: id, status }, 'decision conflict updated');
  return updated;
}
