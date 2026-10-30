import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { setAiProvider } from '../src/ai/client.js';
import { scripted } from './fakes.js';

const app = createApp();
let alice: { id: string };
let bob: { id: string };

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "DecisionConflict","KnowledgeLink","ItemEvent","ActionItem","Decision","KnowledgeDoc","Participant","Session","Person" CASCADE',
  );
  alice = await prisma.person.create({ data: { name: 'Alice Rao', email: 'alice@test.dev' } });
  bob = await prisma.person.create({ data: { name: 'Bob Iyer', email: 'bob@test.dev' } });
});
afterEach(() => setAiProvider(null));
afterAll(() => prisma.$disconnect());

const newMeeting = (extra: object = {}) =>
  request(app)
    .post('/api/sessions')
    .send({ title: 'Weekly sync', scheduledAt: '2026-10-28', participantIds: [alice.id, bob.id], ...extra });

describe('sessions and items', () => {
  it('rejects invalid input with field-level errors and a request id', async () => {
    const res = await request(app).post('/api/sessions').send({ title: '', scheduledAt: 'not a date' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['title', 'scheduledAt']));
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('requires both people for a work transfer', async () => {
    const res = await newMeeting({ kind: 'TRANSFER', fromPersonId: alice.id });
    expect(res.status).toBe(400);
  });

  it('will not close an item without an outcome, and records history when it does', async () => {
    const s = (await newMeeting({ actionItems: [{ title: 'Ship it', ownerId: alice.id }] })).body;
    const itemId = s.items[0].id;

    const refused = await request(app).patch(`/api/items/${itemId}`).send({ status: 'DONE' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('OUTCOME_REQUIRED');

    const ok = await request(app).patch(`/api/items/${itemId}`).send({ status: 'DONE', outcome: 'Shipped in 3.4', ownerId: bob.id });
    expect(ok.status).toBe(200);
    expect(ok.body.closedAt).toBeTruthy();
    expect(ok.body.events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'STATUS_CHANGED', 'REASSIGNED', 'OUTCOME_RECORDED']);
  });

  it('carries only open items forward and keeps their history', async () => {
    const first = (await newMeeting({ actionItems: [{ title: 'Open one' }, { title: 'Done one' }] })).body;
    await request(app).patch(`/api/items/${first.items[1].id}`).send({ status: 'DONE', outcome: 'done' });

    const next = await newMeeting({ title: 'Next sync', scheduledAt: '2026-11-04', carryFromId: first.id });
    expect(next.status).toBe(201);
    expect(next.body.carried).toBe(1);
    expect(next.body.previous.id).toBe(first.id);
    const carried = next.body.items[0];
    expect(carried.title).toBe('Open one');
    expect(carried.originSession.id).toBe(first.id);
    expect(carried.events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'CARRIED_FORWARD']);
  });

  it('will not close a session that still has open items', async () => {
    const s = (await newMeeting({ actionItems: [{ title: 'Still open' }] })).body;
    const res = await request(app).patch(`/api/sessions/${s.id}`).send({ status: 'CLOSED' });
    expect(res.status).toBe(409);
  });
});

describe('AI features', () => {
  it('drafts a recap and maps owner names to participants without saving anything', async () => {
    setAiProvider(
      scripted([
        JSON.stringify({
          summary: 'Agreed to ship Friday.',
          decisions: ['Ship on Friday'],
          actionItems: [
            { title: 'Write release notes', owner: 'Alice', dueDate: '2026-10-31', evidence: 'Alice will write notes' },
            { title: 'Tell support', owner: 'Sam', dueDate: null, evidence: null },
          ],
        }),
      ]),
    );
    const s = (await newMeeting()).body;
    const res = await request(app).post(`/api/sessions/${s.id}/recap/draft`).send({ raw: 'Alice will write notes. Sam tells support. Ship Friday.' });
    expect(res.status).toBe(200);
    expect(res.body.actionItems[0].ownerId).toBe(alice.id);
    expect(res.body.actionItems[1]).toMatchObject({ ownerId: null, suggestedOwner: 'Sam' });
    expect(await prisma.actionItem.count()).toBe(0);
  });

  it('returns 503 AI_UNAVAILABLE for a recap when AI is down, so the user can enter it by hand', async () => {
    const s = (await newMeeting()).body;
    const res = await request(app).post(`/api/sessions/${s.id}/recap/draft`).send({ raw: 'Some meeting notes that are long enough.' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('applies a recap even when AI follow-ups are unavailable, and says so', async () => {
    const s = (await newMeeting()).body;
    const res = await request(app)
      .post(`/api/sessions/${s.id}/recap/apply`)
      .send({ summary: 'We met.', decisions: ['Use Postgres'], actionItems: [{ title: 'Create schema', ownerId: alice.id }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ decisions: 1, items: 1 });
    expect(res.body.warnings.join(' ')).toMatch(/AI unavailable/);
    expect(await prisma.knowledgeDoc.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it('falls back to a data-only brief that lists the reader\'s own items', async () => {
    const s = (await newMeeting({ actionItems: [{ title: 'Alice task', ownerId: alice.id }, { title: 'Bob task', ownerId: bob.id }] })).body;
    const res = await request(app).post(`/api/sessions/${s.id}/brief`).send({ readerId: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.brief.yourActions.join()).toContain('Alice task');
    expect(res.body.brief.openItems.join()).toContain('Bob task');
  });

  it('stores only conflicts between ids it sent and above the confidence bar', async () => {
    const old = (await newMeeting({ title: 'Old' })).body;
    await request(app).post(`/api/sessions/${old.id}/recap/apply`).send({ summary: 's', decisions: ['Launch UPI autopay on 1 November'], actionItems: [] });
    const fresh = (await newMeeting({ title: 'New' })).body;

    // A fake model that answers the conflict prompt with one real pair, one invented id and one
    // low-confidence pair. Only the real, confident pair may be stored.
    setAiProvider({
      model: 'fake',
      embed: async (texts) => texts.map(() => []),
      async generateText(system, prompt) {
        if (!system.includes('contradict')) return '{"links": []}';
        const [q] = JSON.parse(prompt) as { decisionId: string; earlierDecisions: { pastDecisionId: string }[] }[];
        const past = q.earlierDecisions[0].pastDecisionId;
        return JSON.stringify({
          conflicts: [
            { decisionId: q.decisionId, pastDecisionId: past, explanation: 'Launch date moved from 1 to 15 November', confidence: 0.9 },
            { decisionId: q.decisionId, pastDecisionId: 'made-up-id', explanation: 'Hallucinated', confidence: 0.99 },
            { decisionId: 'also-made-up', pastDecisionId: past, explanation: 'Hallucinated', confidence: 0.99 },
          ],
        });
      },
    });
    const res = await request(app)
      .post(`/api/sessions/${fresh.id}/recap/apply`)
      .send({ summary: 's', decisions: ['Move UPI autopay launch to 15 November'], actionItems: [] });
    expect(res.status).toBe(200);
    expect(res.body.conflicts).toBe(1);
    const stored = await prisma.decisionConflict.findMany({ include: { pastDecision: true } });
    expect(stored).toHaveLength(1);
    expect(stored[0].pastDecision.text).toContain('1 November');
  });
});
