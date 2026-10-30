import { prisma } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { generateJson } from '../ai/client.js';
import { RECAP_SYSTEM, recapPrompt, recapSchema } from '../ai/prompts.js';
import { createItems, OPEN_STATUSES, updateItem } from './items.js';
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
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: { include: { person: true } },
      items: { where: { status: { in: OPEN_STATUSES } }, include: { owner: true } },
    },
  });
  if (!s) throw notFound('Session');
  const people = s.participants.map((p) => p.person);
  const openById = new Map(s.items.map((i) => [i.id, i]));

  const recap = await generateJson(
    'recap.draft',
    recapSchema,
    RECAP_SYSTEM,
    recapPrompt({
      title: s.title,
      meetingDate: s.scheduledAt.toISOString().slice(0, 10),
      participants: people.map((p) => p.name),
      agenda: s.agenda,
      openItems: s.items.map((i) => ({ id: i.id, title: i.title, owner: i.owner?.name ?? 'unassigned' })),
      raw,
    }),
  );

  return {
    summary: recap.summary,
    decisions: recap.decisions,
    actionItems: recap.actionItems.map((a) => {
      const owner = matchOwner(a.owner, people);
      // Only accept an id we actually sent; anything else is treated as a new item.
      const existing = a.existingItemId ? openById.get(a.existingItemId) : undefined;
      return {
        title: existing?.title ?? a.title,
        ownerId: owner?.id ?? existing?.ownerId ?? null,
        // Kept so the UI can show "AI said 'Sam' but no participant matches" instead of silently dropping it.
        suggestedOwner: owner ? null : a.owner,
        dueDate: a.dueDate ?? existing?.dueDate?.toISOString().slice(0, 10) ?? null,
        evidence: a.evidence,
        existingItemId: existing?.id ?? null,
      };
    }),
  };
}

export interface ApplyRecapInput {
  summary: string;
  notes?: string;
  decisions: string[];
  actionItems: { title: string; ownerId?: string | null; dueDate?: Date | null; existingItemId?: string | null }[];
}

/**
 * Step 2: save the reviewed recap, then run the AI follow-ups (knowledge links, conflict check).
 * Follow-ups are best-effort: if they fail the recap is still saved and the response says so.
 */
export async function applyRecap(sessionId: string, input: ApplyRecapInput) {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound('Session');

  const updates = input.actionItems.filter((a) => a.existingItemId);
  const creates = input.actionItems.filter((a) => !a.existingItemId);
  if (updates.length) {
    const found = await prisma.actionItem.count({ where: { id: { in: updates.map((u) => u.existingItemId!) } } });
    if (found !== new Set(updates.map((u) => u.existingItemId)).size) throw new AppError(400, 'INVALID_REFERENCE', 'An existing item in the recap no longer exists');
  }

  const { decisions, items } = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sessionId },
      data: { summary: input.summary, notes: input.notes ?? s.notes, status: s.status === 'PLANNED' ? 'HELD' : s.status },
    });
    const decisions = await Promise.all(input.decisions.map((text) => tx.decision.create({ data: { sessionId, text } })));
    const items = await createItems(tx, sessionId, creates);
    return { decisions, items };
  });
  // Items the recap matched to an open item: change owner / due date through the normal path,
  // so the history records it, instead of creating a duplicate.
  for (const u of updates) await updateItem(u.existingItemId!, { ownerId: u.ownerId ?? undefined, dueDate: u.dueDate ?? undefined });
  logger.info({ event: 'recap.applied', sessionId, decisions: decisions.length, items: items.length, updated: updates.length }, 'recap saved');

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
    updated: updates.length,
    links: linkRes.status === 'fulfilled' ? linkRes.value.created : 0,
    conflicts: conflictRes.status === 'fulfilled' ? conflictRes.value.found : 0,
    warnings,
  };
}
