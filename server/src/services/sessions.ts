import type { Attendance, Prisma, SessionKind, SessionStatus, Visibility } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { assertSessionVisible, sessionWhere, type Viewer } from '../access.js';
import { carryForward, createItems, itemInclude, OPEN_STATUSES } from './items.js';

/*
 * Includes below can show linked docs and conflicting decisions without a per-viewer filter:
 * links and conflicts are only ever created when the other record's audience covers this
 * session's audience (see access.ts), and visibility can't change afterwards.
 */
const detailInclude = {
  participants: { include: { person: true }, orderBy: { person: { name: 'asc' } } },
  decisions: {
    orderBy: { createdAt: 'asc' },
    include: {
      conflicts: { include: { pastDecision: { include: { session: { select: { id: true, title: true, scheduledAt: true } } } } } },
      links: { include: { doc: { select: { id: true, title: true, source: true } } } },
    },
  },
  items: { include: itemInclude, orderBy: { createdAt: 'asc' } },
  team: { select: { id: true, name: true } },
  previous: { select: { id: true, title: true } },
  next: { select: { id: true, title: true } },
} satisfies Prisma.SessionInclude;

export interface NewSession {
  kind: SessionKind;
  title: string;
  scheduledAt: Date;
  visibility: Visibility;
  teamId?: string | null;
  agenda?: string;
  notes?: string;
  participantIds: string[];
  fromPersonId?: string | null;
  toPersonId?: string | null;
  carryFromId?: string | null;
  actionItems?: { title: string; ownerId?: string | null; dueDate?: Date | null }[];
}

async function assertPeopleExist(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await prisma.person.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw new AppError(400, 'INVALID_REFERENCE', 'One or more people do not exist');
}

export async function createSession(input: NewSession, viewer: Viewer) {
  if (input.kind === 'TRANSFER') {
    if (!input.fromPersonId || !input.toPersonId) throw new AppError(400, 'VALIDATION_ERROR', 'A work transfer needs both "from" and "to" people');
    if (input.fromPersonId === input.toPersonId) throw new AppError(400, 'VALIDATION_ERROR', 'A work transfer must go to a different person');
  }
  if (input.visibility !== 'ORG' && !input.teamId) throw new AppError(400, 'TEAM_REQUIRED', 'Choose the team this session belongs to');
  if (input.teamId && !viewer.teamIds.includes(input.teamId)) throw new AppError(400, 'INVALID_TEAM', 'You can only create sessions for a team you belong to');
  if (input.carryFromId) await assertSessionVisible(viewer, input.carryFromId);
  // The creator always takes part, so a private session can never be invisible to the person who made it.
  const participantIds = [
    ...new Set([...input.participantIds, input.fromPersonId, input.toPersonId, input.visibility === 'PRIVATE' ? viewer.id : null].filter((x): x is string => Boolean(x))),
  ];
  await assertPeopleExist(participantIds);

  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.session.create({
      data: {
        kind: input.kind,
        title: input.title,
        scheduledAt: input.scheduledAt,
        visibility: input.visibility,
        teamId: input.teamId ?? null,
        createdById: viewer.id,
        agenda: input.agenda ?? '',
        notes: input.notes ?? '',
        fromPersonId: input.kind === 'TRANSFER' ? input.fromPersonId : null,
        toPersonId: input.kind === 'TRANSFER' ? input.toPersonId : null,
        participants: { create: participantIds.map((personId) => ({ personId })) },
      },
    });
    if (input.actionItems?.length) await createItems(tx, s.id, input.actionItems);
    return s;
  });
  logger.info(
    { event: 'session.created', sessionId: session.id, kind: session.kind, visibility: session.visibility, teamId: session.teamId, participants: participantIds.length },
    'session created',
  );

  let carried = 0;
  if (input.carryFromId) carried = (await carryForward(input.carryFromId, session.id)).moved;
  return { ...(await getSession(session.id, viewer)), carried };
}

/** Callers check visibility first (assertSessionVisible); this only hides neighbours the viewer can't see. */
export async function getSession(id: string, viewer: Viewer) {
  const s = await prisma.session.findUnique({
    where: { id },
    include: { ...detailInclude, next: { where: sessionWhere(viewer), select: { id: true, title: true } } },
  });
  if (!s) throw notFound('Session');
  const [from, to, previousVisible] = await Promise.all([
    s.fromPersonId ? prisma.person.findUnique({ where: { id: s.fromPersonId } }) : null,
    s.toPersonId ? prisma.person.findUnique({ where: { id: s.toPersonId } }) : null,
    s.previousId ? prisma.session.count({ where: { id: s.previousId, AND: [sessionWhere(viewer)] } }) : 0,
  ]);
  return { ...s, previous: previousVisible ? s.previous : null, fromPerson: from, toPerson: to };
}

export async function listSessions(filter: { kind?: SessionKind; status?: SessionStatus }, viewer: Viewer) {
  const sessions = await prisma.session.findMany({
    where: { ...filter, AND: [sessionWhere(viewer)] },
    orderBy: { scheduledAt: 'desc' },
    include: {
      team: { select: { id: true, name: true } },
      participants: { include: { person: { select: { id: true, name: true } } } },
      _count: { select: { decisions: true, items: true } },
      items: { where: { status: { in: OPEN_STATUSES } }, select: { id: true } },
    },
  });
  return sessions.map(({ items, ...s }) => ({ ...s, openItems: items.length }));
}

export interface SessionPatch {
  title?: string;
  scheduledAt?: Date;
  status?: SessionStatus;
  agenda?: string;
  notes?: string;
  summary?: string | null;
}

export async function updateSession(id: string, patch: SessionPatch, viewer: Viewer) {
  const s = await prisma.session.findUnique({ where: { id } });
  if (!s) throw notFound('Session');
  if (patch.status === 'CLOSED') {
    const open = await prisma.actionItem.count({ where: { sessionId: id, status: { in: OPEN_STATUSES } } });
    if (open > 0) throw new AppError(409, 'OPEN_ITEMS', `Close or carry forward the ${open} open item(s) before closing this session.`);
  }
  await prisma.session.update({ where: { id }, data: patch });
  if (patch.status && patch.status !== s.status)
    logger.info({ event: 'session.status_changed', sessionId: id, from: s.status, to: patch.status }, 'session status changed');
  return getSession(id, viewer);
}

export async function deleteSession(id: string) {
  const s = await prisma.session.findUnique({ where: { id } });
  if (!s) throw notFound('Session');
  await prisma.session.delete({ where: { id } });
  logger.info({ event: 'session.deleted', sessionId: id }, 'session deleted');
}

export async function setAttendance(sessionId: string, personId: string, attendance: Attendance, viewer: Viewer) {
  await assertPeopleExist([personId]);
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound('Session');
  await prisma.participant.upsert({
    where: { sessionId_personId: { sessionId, personId } },
    create: { sessionId, personId, attendance },
    update: { attendance },
  });
  return getSession(sessionId, viewer);
}

export async function removeParticipant(sessionId: string, personId: string, viewer: Viewer) {
  await prisma.participant.delete({ where: { sessionId_personId: { sessionId, personId } } });
  return getSession(sessionId, viewer);
}

/** Work transfer: hand every open item of the leaver to the person taking over. */
export async function transferItems(sessionId: string) {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound('Session');
  if (s.kind !== 'TRANSFER' || !s.fromPersonId || !s.toPersonId) throw new AppError(400, 'NOT_A_TRANSFER', 'Only a work transfer can hand over items');
  const [from, to] = await Promise.all([
    prisma.person.findUniqueOrThrow({ where: { id: s.fromPersonId } }),
    prisma.person.findUniqueOrThrow({ where: { id: s.toPersonId } }),
  ]);
  const open = await prisma.actionItem.findMany({ where: { ownerId: from.id, status: { in: OPEN_STATUSES } } });
  await prisma.$transaction(
    open.map((it) =>
      prisma.actionItem.update({
        where: { id: it.id },
        data: {
          ownerId: to.id,
          events: { create: { type: 'REASSIGNED', fromValue: from.name, toValue: to.name, note: `Work transfer: ${s.title}`, sessionId } },
        },
      }),
    ),
  );
  for (const it of open) logger.info({ event: 'item.reassigned', itemId: it.id, from: from.name, to: to.name, sessionId }, 'action item reassigned by work transfer');
  return { reassigned: open.length };
}
