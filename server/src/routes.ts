import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from './db.js';
import { isAiAvailable } from './ai/client.js';
import { assertConflictVisible, assertDocVisible, assertItemVisible, assertSessionVisible, type Viewer } from './access.js';
import { issueToken, requireAuth, viewerOf } from './auth.js';
import { AppError } from './errors.js';
import { catchUpBrief } from './services/brief.js';
import { myActivity, whatIMissed } from './services/activity.js';
import { ask } from './services/ask.js';
import { listConflicts, resolveConflict } from './services/conflicts.js';
import { carryForward, createItem, getItem, listItems, updateItem } from './services/items.js';
import { createDoc, deleteDoc, linkToKnowledge, listDocs } from './services/knowledge.js';
import { applyRecap, draftRecap } from './services/recap.js';
import * as sessions from './services/sessions.js';
import { logger } from './logger.js';

const id = z.string().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);
const date = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');
const status = z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'DROPPED']);
const visibility = z.enum(['PRIVATE', 'TEAM', 'ORG']);
const newItem = z.object({
  title: text(300).min(1),
  ownerId: id.nullish(),
  dueDate: date.nullish(),
});

/** Parses :id and 404s unless the signed-in user may see that session. */
async function visibleSession(req: Request): Promise<[string, Viewer]> {
  const v = viewerOf(req);
  const sid = id.parse(req.params.id);
  await assertSessionVisible(v, sid);
  return [sid, v];
}

export const api = Router();

// ---------- Public: health and sign-in ----------
api.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, ai: isAiAvailable() ? 'configured' : 'not configured' });
});

/** Demo sign-in: pick a person and get a signed token. A real deployment would use SSO here. */
api.get('/auth/people', async (_req, res) => {
  const people = await prisma.person.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true, memberships: { select: { team: { select: { id: true, name: true } } } } },
  });
  res.json(people.map(({ memberships, ...p }) => ({ ...p, teams: memberships.map((m) => m.team) })));
});
api.post('/auth/login', async (req, res) => {
  const { personId } = z.object({ personId: id }).parse(req.body);
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new AppError(400, 'UNKNOWN_PERSON', 'No such person');
  logger.info({ event: 'auth.login', personId }, 'signed in');
  res.json({ token: issueToken(person.id) });
});

api.use(requireAuth);

api.get('/auth/me', async (req, res) => {
  const v = viewerOf(req);
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: v.id },
    include: { memberships: { include: { team: { select: { id: true, name: true } } } } },
  });
  res.json({ id: person.id, name: person.name, role: person.role, teams: person.memberships.map((m) => m.team) });
});

api.get('/me/missed', async (req, res) => {
  res.json(await whatIMissed(viewerOf(req)));
});

/** Your own requests only: lets anyone trace an error's request ID without seeing other people's activity. */
api.get('/me/activity', async (req, res) => {
  const { requestId } = z.object({ requestId: z.string().regex(/^[\w-]{1,64}$/).optional() }).parse(req.query);
  res.json(await myActivity(viewerOf(req), requestId));
});

// ---------- Ask Relay ----------
api.post('/ask', async (req, res) => {
  const { question } = z.object({ question: text(500).min(3, 'Ask a question of at least a few words') }).parse(req.body);
  res.json(await ask(question, viewerOf(req)));
});

// ---------- People ----------
api.get('/people', async (_req, res) => {
  res.json(await prisma.person.findMany({ orderBy: { name: 'asc' } }));
});
api.post('/people', async (req, res) => {
  const body = z.object({ name: text(100).min(1), email: z.string().trim().toLowerCase().email(), role: text(100).optional() }).parse(req.body);
  const person = await prisma.person.create({ data: body });
  logger.info({ event: 'person.created', personId: person.id }, 'person created');
  res.status(201).json(person);
});

// ---------- Sessions (meetings and work transfers) ----------
api.get('/sessions', async (req, res) => {
  const q = z.object({ kind: z.enum(['MEETING', 'TRANSFER']).optional(), status: z.enum(['PLANNED', 'HELD', 'CLOSED']).optional() }).parse(req.query);
  res.json(await sessions.listSessions(q, viewerOf(req)));
});
api.post('/sessions', async (req, res) => {
  const body = z
    .object({
      kind: z.enum(['MEETING', 'TRANSFER']).default('MEETING'),
      title: text(200).min(1),
      scheduledAt: date,
      visibility: visibility.default('TEAM'),
      teamId: id.nullish(),
      agenda: text(5000).optional(),
      notes: text(20000).optional(),
      participantIds: z.array(id).max(50).default([]),
      fromPersonId: id.nullish(),
      toPersonId: id.nullish(),
      carryFromId: id.nullish(),
      actionItems: z.array(newItem).max(50).optional(),
    })
    .parse(req.body);
  res.status(201).json(await sessions.createSession(body, viewerOf(req)));
});
api.get('/sessions/:id', async (req, res) => {
  const [sid, v] = await visibleSession(req);
  res.json(await sessions.getSession(sid, v));
});
api.patch('/sessions/:id', async (req, res) => {
  const [sid, v] = await visibleSession(req);
  const body = z
    .object({
      title: text(200).min(1).optional(),
      scheduledAt: date.optional(),
      status: z.enum(['PLANNED', 'HELD', 'CLOSED']).optional(),
      agenda: text(5000).optional(),
      notes: text(20000).optional(),
      summary: text(5000).nullable().optional(),
    })
    .strict()
    .parse(req.body);
  res.json(await sessions.updateSession(sid, body, v));
});
api.delete('/sessions/:id', async (req, res) => {
  const [sid] = await visibleSession(req);
  await sessions.deleteSession(sid);
  res.status(204).end();
});
api.put('/sessions/:id/participants/:personId', async (req, res) => {
  const [sid, v] = await visibleSession(req);
  const { attendance } = z.object({ attendance: z.enum(['INVITED', 'ATTENDED', 'MISSED']) }).parse(req.body);
  res.json(await sessions.setAttendance(sid, id.parse(req.params.personId), attendance, v));
});
api.delete('/sessions/:id/participants/:personId', async (req, res) => {
  const [sid, v] = await visibleSession(req);
  res.json(await sessions.removeParticipant(sid, id.parse(req.params.personId), v));
});
api.post('/sessions/:id/items', async (req, res) => {
  const [sid] = await visibleSession(req);
  res.status(201).json(await createItem(sid, newItem.parse(req.body)));
});
api.post('/sessions/:id/carry-forward', async (req, res) => {
  const [sid, v] = await visibleSession(req);
  const { toSessionId } = z.object({ toSessionId: id }).parse(req.body);
  await assertSessionVisible(v, toSessionId);
  res.json(await carryForward(sid, toSessionId));
});
api.post('/sessions/:id/transfer-items', async (req, res) => {
  const [sid] = await visibleSession(req);
  res.json(await sessions.transferItems(sid));
});

// ---------- AI: recap, brief ----------
api.post('/sessions/:id/recap/draft', async (req, res) => {
  const [sid] = await visibleSession(req);
  const { raw } = z.object({ raw: text(30000).min(20, 'Paste at least a few sentences to recap') }).parse(req.body);
  res.json(await draftRecap(sid, raw));
});
api.post('/sessions/:id/recap/apply', async (req, res) => {
  const [sid] = await visibleSession(req);
  const body = z
    .object({
      summary: text(5000).min(1),
      notes: text(30000).optional(),
      decisions: z.array(text(1000).min(1)).max(30),
      actionItems: z.array(newItem.extend({ existingItemId: id.nullish() })).max(40),
    })
    .parse(req.body);
  res.json(await applyRecap(sid, body));
});
api.post('/sessions/:id/brief', async (req, res) => {
  const [sid, v] = await visibleSession(req);
  const { readerId } = z.object({ readerId: id.optional() }).parse(req.body ?? {});
  res.json(await catchUpBrief(sid, v, readerId));
});

// ---------- Action items ----------
api.get('/items', async (req, res) => {
  const q = z
    .object({
      status: status.optional(),
      ownerId: id.optional(),
      open: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
      overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    })
    .parse(req.query);
  res.json(await listItems(q, viewerOf(req)));
});
api.get('/items/:id', async (req, res) => {
  const itemId = id.parse(req.params.id);
  await assertItemVisible(viewerOf(req), itemId);
  res.json(await getItem(itemId));
});
api.patch('/items/:id', async (req, res) => {
  const itemId = id.parse(req.params.id);
  await assertItemVisible(viewerOf(req), itemId);
  const body = z
    .object({
      title: text(300).min(1).optional(),
      status: status.optional(),
      ownerId: id.nullable().optional(),
      dueDate: date.nullable().optional(),
      outcome: text(2000).nullable().optional(),
    })
    .strict()
    .parse(req.body);
  res.json(await updateItem(itemId, body));
});
api.post('/items/:id/link', async (req, res) => {
  const itemId = id.parse(req.params.id);
  await assertItemVisible(viewerOf(req), itemId);
  const item = await getItem(itemId);
  const result = await linkToKnowledge([{ kind: 'item', id: item.id, text: item.title }], item.sessionId);
  res.json({ ...result, item: await getItem(item.id) });
});

// ---------- Knowledge base ----------
api.get('/knowledge', async (req, res) => {
  const { q } = z.object({ q: text(200).optional() }).parse(req.query);
  res.json(await listDocs(q || undefined, viewerOf(req)));
});
api.post('/knowledge', async (req, res) => {
  const body = z
    .object({ title: text(200).min(1), content: text(50000).min(1), visibility: visibility.default('TEAM'), teamId: id.nullish() })
    .parse(req.body);
  res.status(201).json(await createDoc(body, viewerOf(req)));
});
api.delete('/knowledge/:id', async (req, res) => {
  const docId = id.parse(req.params.id);
  await assertDocVisible(viewerOf(req), docId);
  await deleteDoc(docId);
  res.status(204).end();
});

// ---------- Decision conflicts (special feature) ----------
api.get('/conflicts', async (req, res) => {
  const q = z.object({ status: z.enum(['OPEN', 'DISMISSED', 'RESOLVED']).optional() }).parse(req.query);
  res.json(await listConflicts(q.status, viewerOf(req)));
});
api.patch('/conflicts/:id', async (req, res) => {
  const conflictId = id.parse(req.params.id);
  await assertConflictVisible(viewerOf(req), conflictId);
  const body = z.object({ status: z.enum(['OPEN', 'DISMISSED', 'RESOLVED']), resolution: text(2000).optional() }).parse(req.body);
  res.json(await resolveConflict(conflictId, body.status, body.resolution));
});
