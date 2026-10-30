import { prisma } from '../db.js';
import { notFound } from '../errors.js';
import { logger } from '../logger.js';
import { generateJson } from '../ai/client.js';
import { RECAP_SYSTEM, recapPrompt, recapSchema } from '../ai/prompts.js';
import { createItems } from './items.js';
import { indexSession, linkToKnowledge } from './knowledge.js';
import { checkConflicts } from './conflicts.js';

interface PersonLite {
  id: string;
  name: string;
}

/** Matches a name the model wrote to a participant: exact full name first, then a unique first name. */
export function matchOwner(name: string | null, people: PersonLite[]): PersonLite | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const exact = people.find((p) => p.name.toLowerCase() === n);
  if (exact) return exact;
  const first = people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
  return first.length === 1 ? first[0] : null;
}

/** Step 1: AI turns raw text into a draft. Nothing is saved; the user reviews it first. */
export async function draftRecap(sessionId: string, raw: string) {
  const s = await prisma.session.findUnique({ where: { id: sessionId }, include: { participants: { include: { person: true } } } });
  if (!s) throw notFound('Session');
  const people = s.participants.map((p) => p.person);

  const recap = await generateJson(
    'recap.draft',
    recapSchema,
    RECAP_SYSTEM,
    recapPrompt({ title: s.title, today: new Date().toISOString().slice(0, 10), participants: people.map((p) => p.name), agenda: s.agenda, raw }),
  );

  return {
    summary: recap.summary,
    decisions: recap.decisions,
    actionItems: recap.actionItems.map((a) => {
      const owner = matchOwner(a.owner, people);
      return {
        title: a.title,
        ownerId: owner?.id ?? null,
        // Kept so the UI can show "AI said 'Sam' but no participant matches" instead of silently dropping it.
        suggestedOwner: owner ? null : a.owner,
        dueDate: a.dueDate,
        evidence: a.evidence,
      };
    }),
  };
}

export interface ApplyRecapInput {
  summary: string;
  notes?: string;
  decisions: string[];
  actionItems: { title: string; ownerId?: string | null; dueDate?: Date | null }[];
}

/**
 * Step 2: save the reviewed recap, then run the AI follow-ups (knowledge links, conflict check).
 * Follow-ups are best-effort: if they fail the recap is still saved and the response says so.
 */
export async function applyRecap(sessionId: string, input: ApplyRecapInput) {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound('Session');

  const { decisions, items } = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sessionId },
      data: { summary: input.summary, notes: input.notes ?? s.notes, status: s.status === 'PLANNED' ? 'HELD' : s.status },
    });
    const decisions = await Promise.all(input.decisions.map((text) => tx.decision.create({ data: { sessionId, text } })));
    const items = await createItems(tx, sessionId, input.actionItems);
    return { decisions, items };
  });
  logger.info({ event: 'recap.applied', sessionId, decisions: decisions.length, items: items.length }, 'recap saved');

  const warnings: string[] = [];
  const [linkRes, conflictRes] = await Promise.allSettled([
    linkToKnowledge(
      [...items.map((i) => ({ kind: 'item' as const, id: i.id, text: i.title })), ...decisions.map((d) => ({ kind: 'decision' as const, id: d.id, text: d.text }))],
      sessionId,
    ),
    checkConflicts(sessionId),
  ]);
  if (linkRes.status === 'rejected') warnings.push('Knowledge linking failed; you can retry later.');
  else if (linkRes.value.mode === 'fallback') warnings.push('AI unavailable: knowledge links use simple word matching.');
  if (conflictRes.status === 'rejected') warnings.push('Decision conflict check failed (AI unavailable).');
  else if (!conflictRes.value.checked && decisions.length) warnings.push('Decision conflict check skipped (AI unavailable).');

  // Index after linking so a session never links to itself.
  await indexSession(sessionId).catch((err) => {
    logger.warn({ event: 'kb.index_failed', sessionId, err }, 'session indexing failed');
    warnings.push('Could not add this session to the knowledge base.');
  });

  return {
    decisions: decisions.length,
    items: items.length,
    links: linkRes.status === 'fulfilled' ? linkRes.value.created : 0,
    conflicts: conflictRes.status === 'fulfilled' ? conflictRes.value.found : 0,
    warnings,
  };
}
