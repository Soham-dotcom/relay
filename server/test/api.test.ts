import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { setAiProvider } from '../src/ai/client.js';
import { issueToken } from '../src/auth.js';
import { scripted } from './fakes.js';

const app = createApp();
type P = { id: string };
// Team A: Alice, Bob, Dave. Team B: Carol.
let alice: P, bob: P, carol: P, dave: P;
let teamA: string, teamB: string;

/** Supertest with a signed-in user. */
const as = (who: P) => {
  const auth = { Authorization: `Bearer ${issueToken(who.id)}` };
  return {
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string, body: object = {}) => request(app).post(url).set(auth).send(body),
    patch: (url: string, body: object) => request(app).patch(url).set(auth).send(body),
  };
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "DecisionConflict","KnowledgeLink","ItemEvent","ActionItem","Decision","KnowledgeDoc","Participant","Session","TeamMember","Team","Person" CASCADE',
  );
  [alice, bob, carol, dave] = await Promise.all(
    ['alice', 'bob', 'carol', 'dave'].map((n) => prisma.person.create({ data: { name: `${n[0].toUpperCase()}${n.slice(1)} Test`, email: `${n}@test.dev` } })),
  );
  teamA = (await prisma.team.create({ data: { name: 'Team A', members: { create: [alice, bob, dave].map((p) => ({ personId: p.id })) } } })).id;
  teamB = (await prisma.team.create({ data: { name: 'Team B', members: { create: [{ personId: carol.id }] } } })).id;
});
afterEach(() => setAiProvider(null));
afterAll(() => prisma.$disconnect());

const newMeeting = (extra: object = {}, who: P = alice) =>
  as(who).post('/api/sessions', { title: 'Weekly sync', scheduledAt: '2026-10-28', teamId: teamA, participantIds: [alice.id, bob.id], ...extra });

describe('sessions and items', () => {
  it('rejects invalid input with field-level errors and a request id', async () => {
    const res = await as(alice).post('/api/sessions', { title: '', scheduledAt: 'not a date' });
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

    const refused = await as(alice).patch(`/api/items/${itemId}`, { status: 'DONE' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('OUTCOME_REQUIRED');

    const ok = await as(alice).patch(`/api/items/${itemId}`, { status: 'DONE', outcome: 'Shipped in 3.4', ownerId: bob.id });
    expect(ok.status).toBe(200);
    expect(ok.body.closedAt).toBeTruthy();
    expect(ok.body.events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'STATUS_CHANGED', 'REASSIGNED', 'OUTCOME_RECORDED']);
  });

  it('carries only open items forward and keeps their history', async () => {
    const first = (await newMeeting({ actionItems: [{ title: 'Open one' }, { title: 'Done one' }] })).body;
    await as(alice).patch(`/api/items/${first.items[1].id}`, { status: 'DONE', outcome: 'done' });

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
    const res = await as(alice).patch(`/api/sessions/${s.id}`, { status: 'CLOSED' });
    expect(res.status).toBe(409);
  });
});

describe('access control', () => {
  it('rejects requests without a valid token', async () => {
    expect((await request(app).get('/api/sessions')).status).toBe(401);
    const bad = await request(app).get('/api/sessions').set('Authorization', 'Bearer not-a-real-token');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');
  });

  it("hides a private session from a teammate who isn't in it, with 404 rather than 403", async () => {
    const s = (await newMeeting({ visibility: 'PRIVATE', participantIds: [] })).body; // Alice alone (added as creator)
    expect((await as(alice).get(`/api/sessions/${s.id}`)).status).toBe(200);
    const denied = await as(bob).get(`/api/sessions/${s.id}`);
    expect(denied.status).toBe(404);
    expect((await as(bob).get('/api/sessions')).body).toHaveLength(0);
    // Every session-scoped action is guarded, not just the detail page.
    expect((await as(bob).post(`/api/sessions/${s.id}/brief`)).status).toBe(404);
  });

  it('team sessions are invisible to other teams; org sessions are visible to everyone', async () => {
    const team = (await newMeeting({ participantIds: [] })).body;
    const org = (await newMeeting({ visibility: 'ORG', teamId: null, participantIds: [], title: 'All hands' })).body;
    expect((await as(carol).get(`/api/sessions/${team.id}`)).status).toBe(404);
    const carolSees = (await as(carol).get('/api/sessions')).body.map((s: { title: string }) => s.title);
    expect(carolSees).toEqual(['All hands']);
    expect((await as(carol).get(`/api/sessions/${org.id}`)).status).toBe(200);
  });

  it('cannot create a session for a team you are not in', async () => {
    const res = await newMeeting({ teamId: teamB });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TEAM');
  });

  it('always shows people their own items, even from a session they cannot open', async () => {
    const s = (await newMeeting({ visibility: 'PRIVATE', participantIds: [], actionItems: [{ title: 'Carol owes this', ownerId: carol.id }] })).body;
    expect((await as(carol).get(`/api/sessions/${s.id}`)).status).toBe(404);
    const items = (await as(carol).get('/api/items')).body;
    expect(items.map((i: { title: string }) => i.title)).toEqual(['Carol owes this']);
  });

  it('knowledge docs: org for everyone, team for the team, private for the author', async () => {
    await as(alice).post('/api/knowledge', { title: 'Org policy', content: 'x', visibility: 'ORG' });
    await as(alice).post('/api/knowledge', { title: 'Team A runbook', content: 'x', visibility: 'TEAM', teamId: teamA });
    await as(alice).post('/api/knowledge', { title: 'Alice draft', content: 'x', visibility: 'PRIVATE' });
    const titles = async (p: P) => (await as(p).get('/api/knowledge')).body.map((d: { title: string }) => d.title).sort();
    expect(await titles(alice)).toEqual(['Alice draft', 'Org policy', 'Team A runbook']);
    expect(await titles(bob)).toEqual(['Org policy', 'Team A runbook']);
    expect(await titles(carol)).toEqual(['Org policy']);
  });

  it("the brief only uses what both the requester and the reader can see", async () => {
    // Bob owns an item in a private Bob+Dave session. Alice can't see that session.
    await newMeeting({ visibility: 'PRIVATE', participantIds: [dave.id], actionItems: [{ title: 'Secret private task', ownerId: bob.id }] }, bob);
    const team = (await newMeeting({ actionItems: [{ title: 'Public team task', ownerId: bob.id }] })).body;

    const brief = await as(alice).post(`/api/sessions/${team.id}/brief`, { readerId: bob.id });
    expect(brief.status).toBe(200);
    expect(JSON.stringify(brief.body)).toContain('Public team task');
    expect(JSON.stringify(brief.body)).not.toContain('Secret private task');

    // Bob asking for his own brief does see his private task.
    const own = await as(bob).post(`/api/sessions/${team.id}/brief`, { readerId: bob.id });
    expect(JSON.stringify(own.body)).toContain('Secret private task');

    // And nobody can write a brief for someone who can't see the session.
    const leak = await as(alice).post(`/api/sessions/${team.id}/brief`, { readerId: carol.id });
    expect(leak.status).toBe(400);
    expect(leak.body.error.code).toBe('READER_NO_ACCESS');
  });

  it('knowledge linking never suggests a doc the item audience cannot see', async () => {
    const words = 'webhook replay script staging runbook';
    await as(alice).post('/api/knowledge', { title: `Private ${words}`, content: words, visibility: 'PRIVATE' });
    await as(alice).post('/api/knowledge', { title: `Team ${words}`, content: words, visibility: 'TEAM', teamId: teamA });
    await as(carol).post('/api/knowledge', { title: `Other team ${words}`, content: words, visibility: 'TEAM', teamId: teamB });
    const s = (await newMeeting({ actionItems: [{ title: 'Test the webhook replay script on staging' }] })).body;

    const res = await as(alice).post(`/api/items/${s.items[0].id}/link`);
    expect(res.body.mode).toBe('fallback');
    const linked = res.body.item.links.map((l: { doc: { title: string } }) => l.doc.title);
    expect(linked).toEqual([`Team ${words}`]);
  });

  it('the conflict check never compares with decisions outside the audience', async () => {
    // A decision only Alice+Dave can see, and one the whole team can see.
    const priv = (await newMeeting({ visibility: 'PRIVATE', participantIds: [dave.id] })).body;
    await as(alice).post(`/api/sessions/${priv.id}/recap/apply`, { summary: 's', decisions: ['Launch privately on 1 November'], actionItems: [] });
    const pub = (await newMeeting()).body;
    await as(alice).post(`/api/sessions/${pub.id}/recap/apply`, { summary: 's', decisions: ['Launch publicly on 1 November'], actionItems: [] });

    const prompts: string[] = [];
    setAiProvider({
      model: 'fake',
      embed: async (texts) => texts.map(() => []),
      async generateText(system, prompt) {
        if (!system.includes('contradict')) return '{"links": []}';
        prompts.push(prompt);
        return '{"conflicts": []}';
      },
    });
    const fresh = (await newMeeting()).body;
    await as(alice).post(`/api/sessions/${fresh.id}/recap/apply`, { summary: 's', decisions: ['Launch moves to 15 November'], actionItems: [] });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Launch publicly on 1 November');
    expect(prompts[0]).not.toContain('Launch privately');
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
    const res = await as(alice).post(`/api/sessions/${s.id}/recap/draft`, { raw: 'Alice will write notes. Sam tells support. Ship Friday.' });
    expect(res.status).toBe(200);
    expect(res.body.actionItems[0].ownerId).toBe(alice.id);
    expect(res.body.actionItems[1]).toMatchObject({ ownerId: null, suggestedOwner: 'Sam' });
    expect(await prisma.actionItem.count()).toBe(0);
  });

  it('matches already-open items instead of duplicating them, and ignores invented ids', async () => {
    const s = (await newMeeting({ scheduledAt: '2026-11-04', actionItems: [{ title: 'Run k6 load test at 200 mandates/minute', ownerId: bob.id }] })).body;
    const existingId = s.items[0].id;
    setAiProvider({
      model: 'fake',
      embed: async (texts) => texts.map(() => []),
      async generateText(_sys, prompt) {
        expect(prompt).toContain('Meeting date: 2026-11-04');
        expect(prompt).toContain(existingId);
        return JSON.stringify({
          summary: 'Load test unblocked.',
          decisions: [],
          actionItems: [
            { title: 'Run k6 load test', owner: 'Alice', dueDate: '2026-11-06', evidence: 'run k6 by thursday', existingItemId: existingId },
            { title: 'Get sandbox keys', owner: null, dueDate: null, evidence: null, existingItemId: 'invented-id' },
          ],
        });
      },
    });
    const draft = (await as(alice).post(`/api/sessions/${s.id}/recap/draft`, { raw: 'Vikram will run k6 by thursday. Need sandbox keys.' })).body;
    expect(draft.actionItems[0]).toMatchObject({ existingItemId: existingId, title: 'Run k6 load test at 200 mandates/minute', ownerId: alice.id });
    expect(draft.actionItems[1].existingItemId).toBeNull();

    const res = await as(alice).post(`/api/sessions/${s.id}/recap/apply`, { summary: draft.summary, decisions: [], actionItems: draft.actionItems });
    expect(res.body).toMatchObject({ items: 1, updated: 1 });
    expect(await prisma.actionItem.count()).toBe(2);
    const updated = await prisma.actionItem.findUniqueOrThrow({ where: { id: existingId }, include: { events: true } });
    expect(updated.ownerId).toBe(alice.id);
    expect(updated.events.map((e) => e.type)).toEqual(expect.arrayContaining(['REASSIGNED', 'DUE_CHANGED']));
  });

  it('returns 503 AI_UNAVAILABLE for a recap when AI is down, so the user can enter it by hand', async () => {
    const s = (await newMeeting()).body;
    const res = await as(alice).post(`/api/sessions/${s.id}/recap/draft`, { raw: 'Some meeting notes that are long enough.' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('applies a recap even when AI follow-ups are unavailable, and says so', async () => {
    const s = (await newMeeting()).body;
    const res = await as(alice).post(`/api/sessions/${s.id}/recap/apply`, {
      summary: 'We met.',
      decisions: ['Use Postgres'],
      actionItems: [{ title: 'Create schema', ownerId: alice.id }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ decisions: 1, items: 1 });
    expect(res.body.warnings.join(' ')).toMatch(/AI unavailable/);
    expect(await prisma.knowledgeDoc.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it("falls back to a data-only brief that lists the reader's own items", async () => {
    const s = (await newMeeting({ actionItems: [{ title: 'Alice task', ownerId: alice.id }, { title: 'Bob task', ownerId: bob.id }] })).body;
    const res = await as(alice).post(`/api/sessions/${s.id}/brief`, { readerId: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.brief.yourActions.join()).toContain('Alice task');
    expect(res.body.brief.openItems.join()).toContain('Bob task');
  });

  it('stores only conflicts between ids it sent and above the confidence bar', async () => {
    const old = (await newMeeting({ title: 'Old' })).body;
    await as(alice).post(`/api/sessions/${old.id}/recap/apply`, { summary: 's', decisions: ['Launch UPI autopay on 1 November'], actionItems: [] });
    const fresh = (await newMeeting({ title: 'New' })).body;

    // A fake model that answers the conflict prompt with one real pair and two invented ids.
    // Only the real, confident pair may be stored.
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
    const res = await as(alice).post(`/api/sessions/${fresh.id}/recap/apply`, { summary: 's', decisions: ['Move UPI autopay launch to 15 November'], actionItems: [] });
    expect(res.status).toBe(200);
    expect(res.body.conflicts).toBe(1);
    const stored = await prisma.decisionConflict.findMany({ include: { pastDecision: true } });
    expect(stored).toHaveLength(1);
    expect(stored[0].pastDecision.text).toContain('1 November');
  });
});
