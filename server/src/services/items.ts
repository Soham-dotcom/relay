import { ItemStatus, Prisma, type ActionItem } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { logger } from '../logger.js';

export const OPEN_STATUSES: ItemStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED'];
const CLOSED_STATUSES: ItemStatus[] = ['DONE', 'DROPPED'];

export const itemInclude = {
  owner: true,
  events: { orderBy: { at: 'asc' } },
  links: { include: { doc: { select: { id: true, title: true, source: true } } } },
  session: { select: { id: true, title: true, kind: true } },
  originSession: { select: { id: true, title: true } },
} satisfies Prisma.ActionItemInclude;

type Tx = Prisma.TransactionClient;

export interface NewItem {
  title: string;
  ownerId?: string | null;
  dueDate?: Date | null;
}

export async function createItems(tx: Tx, sessionId: string, items: NewItem[]): Promise<ActionItem[]> {
  const created: ActionItem[] = [];
  for (const it of items) {
    const item = await tx.actionItem.create({
      data: {
        title: it.title,
        ownerId: it.ownerId ?? null,
        dueDate: it.dueDate ?? null,
        sessionId,
        originSessionId: sessionId,
        events: { create: { type: 'CREATED', toValue: it.title, sessionId } },
      },
    });
    logger.info({ event: 'item.created', itemId: item.id, sessionId, ownerId: item.ownerId }, 'action item created');
    created.push(item);
  }
  return created;
}

export async function createItem(sessionId: string, input: NewItem) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) throw notFound('Session');
  const [item] = await prisma.$transaction((tx) => createItems(tx, sessionId, [input]));
  return prisma.actionItem.findUniqueOrThrow({ where: { id: item.id }, include: itemInclude });
}

export interface ItemPatch {
  title?: string;
  status?: ItemStatus;
  ownerId?: string | null;
  dueDate?: Date | null;
  outcome?: string | null;
}

/** Applies a change and writes one history event per field that actually changed. */
export async function updateItem(id: string, patch: ItemPatch) {
  const item = await prisma.actionItem.findUnique({ where: { id }, include: { owner: true } });
  if (!item) throw notFound('Action item');

  const closing = patch.status && CLOSED_STATUSES.includes(patch.status) && !CLOSED_STATUSES.includes(item.status);
  const outcome = patch.outcome !== undefined ? patch.outcome : item.outcome;
  if (closing && !outcome?.trim()) {
    throw new AppError(422, 'OUTCOME_REQUIRED', 'Record the outcome before closing an item (what happened, or why it was dropped).');
  }

  const events: Prisma.ItemEventCreateManyItemInput[] = [];
  const data: Prisma.ActionItemUncheckedUpdateInput = {};

  if (patch.title !== undefined && patch.title !== item.title) data.title = patch.title;
  if (patch.status && patch.status !== item.status) {
    data.status = patch.status;
    data.closedAt = CLOSED_STATUSES.includes(patch.status) ? new Date() : null;
    events.push({ type: 'STATUS_CHANGED', fromValue: item.status, toValue: patch.status, sessionId: item.sessionId });
  }
  if (patch.ownerId !== undefined && patch.ownerId !== item.ownerId) {
    const newOwner = patch.ownerId ? await prisma.person.findUnique({ where: { id: patch.ownerId } }) : null;
    if (patch.ownerId && !newOwner) throw new AppError(400, 'INVALID_REFERENCE', 'Owner does not exist');
    data.ownerId = patch.ownerId;
    events.push({ type: 'REASSIGNED', fromValue: item.owner?.name ?? 'Unassigned', toValue: newOwner?.name ?? 'Unassigned', sessionId: item.sessionId });
  }
  if (patch.dueDate !== undefined && patch.dueDate?.getTime() !== item.dueDate?.getTime()) {
    data.dueDate = patch.dueDate;
    events.push({ type: 'DUE_CHANGED', fromValue: item.dueDate?.toISOString().slice(0, 10) ?? null, toValue: patch.dueDate?.toISOString().slice(0, 10) ?? null, sessionId: item.sessionId });
  }
  if (patch.outcome !== undefined && patch.outcome !== item.outcome) {
    data.outcome = patch.outcome;
    if (patch.outcome) events.push({ type: 'OUTCOME_RECORDED', toValue: patch.outcome, sessionId: item.sessionId });
  }

  const updated = await prisma.actionItem.update({
    where: { id },
    data: { ...data, events: { createMany: { data: events } } },
    include: itemInclude,
  });

  for (const e of events) {
    if (e.type === 'REASSIGNED') logger.info({ event: 'item.reassigned', itemId: id, from: e.fromValue, to: e.toValue }, 'action item reassigned');
    if (e.type === 'STATUS_CHANGED' && CLOSED_STATUSES.includes(e.toValue as ItemStatus))
      logger.info({ event: 'item.closed', itemId: id, status: e.toValue }, 'action item closed');
    else if (e.type === 'STATUS_CHANGED') logger.info({ event: 'item.status_changed', itemId: id, from: e.fromValue, to: e.toValue }, 'action item status changed');
  }
  return updated;
}

/** Moves every open item of one session into another, keeping its full history. */
export async function carryForward(fromSessionId: string, toSessionId: string) {
  if (fromSessionId === toSessionId) throw new AppError(400, 'INVALID_TARGET', 'Cannot carry items into the same session');
  const [from, to] = await Promise.all([
    prisma.session.findUnique({ where: { id: fromSessionId } }),
    prisma.session.findUnique({ where: { id: toSessionId } }),
  ]);
  if (!from) throw notFound('Source session');
  if (!to) throw notFound('Target session');

  const open = await prisma.actionItem.findMany({ where: { sessionId: fromSessionId, status: { in: OPEN_STATUSES } } });
  await prisma.$transaction([
    ...open.map((it) =>
      prisma.actionItem.update({
        where: { id: it.id },
        data: {
          sessionId: toSessionId,
          events: { create: { type: 'CARRIED_FORWARD', fromValue: from.title, toValue: to.title, sessionId: toSessionId } },
        },
      }),
    ),
    prisma.session.update({ where: { id: toSessionId }, data: { previousId: to.previousId ?? fromSessionId } }),
  ]);
  logger.info({ event: 'items.carried_forward', fromSessionId, toSessionId, count: open.length }, 'open items carried forward');
  return { moved: open.length };
}

export interface ItemFilters {
  status?: ItemStatus;
  ownerId?: string;
  open?: boolean;
  overdue?: boolean;
}

export function listItems(f: ItemFilters) {
  const where: Prisma.ActionItemWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.open) where.status = { in: OPEN_STATUSES };
  if (f.ownerId) where.ownerId = f.ownerId === 'none' ? null : f.ownerId;
  if (f.overdue) {
    where.status = { in: OPEN_STATUSES };
    where.dueDate = { lt: new Date() };
  }
  return prisma.actionItem.findMany({ where, include: itemInclude, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] });
}

export async function getItem(id: string) {
  const item = await prisma.actionItem.findUnique({ where: { id }, include: itemInclude });
  if (!item) throw notFound('Action item');
  return item;
}

/** How many times an item has been pushed to a later session: a simple "slipping" signal. */
export const carryCount = (events: { type: string }[]) => events.filter((e) => e.type === 'CARRIED_FORWARD').length;
