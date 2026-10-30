import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './db.js';
import { isAiAvailable } from './ai/client.js';
import { catchUpBrief } from './services/brief.js';
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
const newItem = z.object({
  title: text(300).min(1),
  ownerId: id.nullish(),
  dueDate: date.nullish(),
});

export const api = Router();

api.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, ai: isAiAvailable() ? 'configured' : 'not configured' });
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
  res.json(await sessions.listSessions(q));
});
api.post('/sessions', async (req, res) => {
  const body = z
    .object({
      kind: z.enum(['MEETING', 'TRANSFER']).default('MEETING'),
      title: text(200).min(1),
      scheduledAt: date,
      agenda: text(5000).optional(),
      notes: text(20000).optional(),
      participantIds: z.array(id).max(50).default([]),
      fromPersonId: id.nullish(),
      toPersonId: id.nullish(),
      carryFromId: id.nullish(),
      actionItems: z.array(newItem).max(50).optional(),
    })
    .parse(req.body);
  res.status(201).json(await sessions.createSession(body));
});
api.get('/sessions/:id', async (req, res) => {
  res.json(await sessions.getSession(id.parse(req.params.id)));
});
api.patch('/sessions/:id', async (req, res) => {
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
  res.json(await sessions.updateSession(id.parse(req.params.id), body));
});
api.delete('/sessions/:id', async (req, res) => {
  await sessions.deleteSession(id.parse(req.params.id));
  res.status(204).end();
});
api.put('/sessions/:id/participants/:personId', async (req, res) => {
  const { attendance } = z.object({ attendance: z.enum(['INVITED', 'ATTENDED', 'MISSED']) }).parse(req.body);
  res.json(await sessions.setAttendance(id.parse(req.params.id), id.parse(req.params.personId), attendance));
});
api.delete('/sessions/:id/participants/:personId', async (req, res) => {
  res.json(await sessions.removeParticipant(id.parse(req.params.id), id.parse(req.params.personId)));
});
api.post('/sessions/:id/items', async (req, res) => {
  res.status(201).json(await createItem(id.parse(req.params.id), newItem.parse(req.body)));
});
api.post('/sessions/:id/carry-forward', async (req, res) => {
  const { toSessionId } = z.object({ toSessionId: id }).parse(req.body);
  res.json(await carryForward(id.parse(req.params.id), toSessionId));
});
api.post('/sessions/:id/transfer-items', async (req, res) => {
  res.json(await sessions.transferItems(id.parse(req.params.id)));
});

// ---------- AI: recap, brief ----------
api.post('/sessions/:id/recap/draft', async (req, res) => {
  const { raw } = z.object({ raw: text(30000).min(20, 'Paste at least a few sentences to recap') }).parse(req.body);
  res.json(await draftRecap(id.parse(req.params.id), raw));
});
api.post('/sessions/:id/recap/apply', async (req, res) => {
  const body = z
    .object({
      summary: text(5000).min(1),
      notes: text(30000).optional(),
      decisions: z.array(text(1000).min(1)).max(30),
      actionItems: z.array(newItem.extend({ existingItemId: id.nullish() })).max(40),
    })
    .parse(req.body);
  res.json(await applyRecap(id.parse(req.params.id), body));
});
api.post('/sessions/:id/brief', async (req, res) => {
  const { readerId } = z.object({ readerId: id.optional() }).parse(req.body ?? {});
  res.json(await catchUpBrief(id.parse(req.params.id), readerId));
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
  res.json(await listItems(q));
});
api.get('/items/:id', async (req, res) => {
  res.json(await getItem(id.parse(req.params.id)));
});
api.patch('/items/:id', async (req, res) => {
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
  res.json(await updateItem(id.parse(req.params.id), body));
});
api.post('/items/:id/link', async (req, res) => {
  const item = await getItem(id.parse(req.params.id));
  const result = await linkToKnowledge([{ kind: 'item', id: item.id, text: item.title }], item.originSessionId);
  res.json({ ...result, item: await getItem(item.id) });
});

// ---------- Knowledge base ----------
api.get('/knowledge', async (req, res) => {
  const { q } = z.object({ q: text(200).optional() }).parse(req.query);
  res.json(await listDocs(q || undefined));
});
api.post('/knowledge', async (req, res) => {
  const body = z.object({ title: text(200).min(1), content: text(50000).min(1) }).parse(req.body);
  res.status(201).json(await createDoc(body.title, body.content));
});
api.delete('/knowledge/:id', async (req, res) => {
  await deleteDoc(id.parse(req.params.id));
  res.status(204).end();
});

// ---------- Decision conflicts (special feature) ----------
api.get('/conflicts', async (req, res) => {
  const q = z.object({ status: z.enum(['OPEN', 'DISMISSED', 'RESOLVED']).optional() }).parse(req.query);
  res.json(await listConflicts(q.status));
});
api.patch('/conflicts/:id', async (req, res) => {
  const body = z.object({ status: z.enum(['OPEN', 'DISMISSED', 'RESOLVED']), resolution: text(2000).optional() }).parse(req.body);
  res.json(await resolveConflict(id.parse(req.params.id), body.status, body.resolution));
});
