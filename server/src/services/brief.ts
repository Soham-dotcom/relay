import { prisma } from '../db.js';
import { notFound } from '../errors.js';
import { logger } from '../logger.js';
import { generateJson, isAiAvailable } from '../ai/client.js';
import { BRIEF_SYSTEM, briefSchema } from '../ai/prompts.js';
import { carryCount, OPEN_STATUSES } from './items.js';
import type { z } from 'zod';

export type Brief = z.infer<typeof briefSchema>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'no due date');

/** Everything the brief may mention, as plain facts. The model sees only this. */
export async function buildBriefContext(sessionId: string, readerId?: string) {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: { include: { person: true } },
      decisions: { include: { conflicts: { where: { status: 'OPEN' }, include: { pastDecision: true } } } },
      items: { include: { owner: true, events: true } },
      previous: { select: { title: true, summary: true } },
    },
  });
  if (!s) throw notFound('Session');
  const reader = readerId ? await prisma.person.findUnique({ where: { id: readerId } }) : null;
  if (readerId && !reader) throw notFound('Reader');
  const [from, to] = await Promise.all([
    s.fromPersonId ? prisma.person.findUnique({ where: { id: s.fromPersonId } }) : null,
    s.toPersonId ? prisma.person.findUnique({ where: { id: s.toPersonId } }) : null,
  ]);
  const now = new Date();

  // A hand-over must cover everything the leaver still owns, and a reader must see all of their own
  // open work, not just the items that happen to sit on this session.
  const extraOwners = [from?.id, reader?.id].filter((x): x is string => Boolean(x));
  const handedOver = extraOwners.length
    ? await prisma.actionItem.findMany({
        where: { ownerId: { in: extraOwners }, status: { in: OPEN_STATUSES }, id: { notIn: s.items.map((i) => i.id) } },
        include: { owner: true, events: true },
      })
    : [];

  return {
    today: day(now),
    session: {
      kind: s.kind === 'TRANSFER' ? 'work transfer' : 'meeting',
      title: s.title,
      date: day(s.scheduledAt),
      status: s.status,
      agenda: s.agenda,
      summary: s.summary ?? '(no recap yet)',
      notes: s.notes.slice(0, 3000),
      handover: s.kind === 'TRANSFER' ? { from: from?.name ?? null, to: to?.name ?? null } : undefined,
      previousSession: s.previous ? { title: s.previous.title, summary: s.previous.summary } : null,
    },
    reader: reader
      ? { name: reader.name, attendance: s.participants.find((p) => p.personId === reader.id)?.attendance ?? 'not a participant' }
      : null,
    participants: s.participants.map((p) => ({ name: p.person.name, attendance: p.attendance })),
    decisions: s.decisions.map((d) => ({
      text: d.text,
      conflictsWith: d.conflicts.map((c) => ({ earlier: c.pastDecision.text, why: c.explanation })),
    })),
    actionItems: [...s.items, ...handedOver].map((i) => ({
      title: i.title,
      owner: i.owner?.name ?? 'unassigned',
      ownedByReader: Boolean(reader && i.ownerId === reader.id),
      status: i.status,
      due: day(i.dueDate),
      overdue: Boolean(i.dueDate && i.dueDate < now && OPEN_STATUSES.includes(i.status)),
      timesCarriedForward: carryCount(i.events),
      outcome: i.outcome,
    })),
  };
}

type Ctx = Awaited<ReturnType<typeof buildBriefContext>>;

/** Used when the model is unavailable: a plain, correct brief built straight from the data. */
export function fallbackBrief(ctx: Ctx): Brief {
  const open = ctx.actionItems.filter((i) => OPEN_STATUSES.includes(i.status as never));
  const fmt = (i: Ctx['actionItems'][number]) => `${i.title} (${i.owner}, due ${i.due}, ${i.status.toLowerCase()})`;
  return {
    headline: `${ctx.session.title} (${ctx.session.date}): ${ctx.decisions.length} decisions, ${open.length} open items.`,
    summary: ctx.session.summary,
    keyDecisions: ctx.decisions.map((d) => d.text).slice(0, 10),
    yourActions: open.filter((i) => i.ownedByReader).map(fmt),
    openItems: open.filter((i) => !i.ownedByReader).map(fmt).slice(0, 20),
    watchOut: [
      ...open.filter((i) => i.overdue).map((i) => `Overdue: ${i.title} (${i.owner})`),
      ...open.filter((i) => i.timesCarriedForward >= 2).map((i) => `Carried forward ${i.timesCarriedForward}x: ${i.title}`),
      ...open.filter((i) => i.owner === 'unassigned').map((i) => `No owner: ${i.title}`),
      ...ctx.decisions.flatMap((d) => d.conflictsWith.map((c) => `Decision "${d.text}" conflicts with earlier "${c.earlier}"`)),
    ].slice(0, 10),
  };
}

export async function catchUpBrief(sessionId: string, readerId?: string) {
  const ctx = await buildBriefContext(sessionId, readerId);
  if (isAiAvailable()) {
    try {
      const brief = await generateJson('brief.generate', briefSchema, BRIEF_SYSTEM, JSON.stringify(ctx));
      logger.info({ event: 'brief.generated', sessionId, readerId, source: 'ai' }, 'catch-up brief generated');
      return { source: 'ai' as const, brief };
    } catch {
      // fall through to the data-only brief
    }
  }
  logger.info({ event: 'brief.generated', sessionId, readerId, source: 'fallback' }, 'catch-up brief generated without AI');
  return { source: 'fallback' as const, brief: fallbackBrief(ctx) };
}
