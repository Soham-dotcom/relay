/*
 * Demo data: a 5-person payments team over three weekly syncs, one work transfer and a planned next
 * meeting. Built to show every feature on first load: items carried forward (with history), an
 * overdue item, closed items with outcomes, knowledge links, and one decision conflict.
 * Wipes the database first. Run: npm run db:seed
 */
import { PrismaClient, type ItemEventType } from '@prisma/client';
import { embedTexts } from '../src/ai/client.js';

const prisma = new PrismaClient();
const d = (s: string) => new Date(`${s}T10:00:00.000Z`);

async function main() {
  await prisma.$transaction([
    prisma.decisionConflict.deleteMany(),
    prisma.knowledgeLink.deleteMany(),
    prisma.itemEvent.deleteMany(),
    prisma.actionItem.deleteMany(),
    prisma.decision.deleteMany(),
    prisma.knowledgeDoc.deleteMany(),
    prisma.participant.deleteMany(),
    prisma.session.deleteMany(),
    prisma.person.deleteMany(),
  ]);

  const people = Object.fromEntries(
    await Promise.all(
      [
        ['priya', 'Priya Sharma', 'Engineering lead'],
        ['rahul', 'Rahul Mehta', 'Backend engineer'],
        ['aisha', 'Aisha Khan', 'Frontend engineer'],
        ['vikram', 'Vikram Rao', 'QA engineer'],
        ['neha', 'Neha Iyer', 'Product manager'],
      ].map(async ([key, name, role]) => [key, await prisma.person.create({ data: { name, role, email: `${key}@payflow.dev` } })] as const),
    ),
  );
  const P = (k: keyof typeof people) => people[k].id;

  // ---------- Knowledge base documents ----------
  const docSpecs = [
    {
      key: 'arch',
      title: 'Payments service architecture',
      content:
        'The payments service is a Node.js API in front of Razorpay. Orders are created in our Postgres database, then a Razorpay order is created. Razorpay calls our /webhooks/razorpay endpoint for payment.captured and payment.failed. Every webhook is stored in the webhook_events table before processing so it can be replayed. Signature verification uses the RAZORPAY_WEBHOOK_SECRET. UPI autopay uses Razorpay subscriptions with an e-mandate.',
    },
    {
      key: 'runbook',
      title: 'Runbook: webhook failures and retries',
      content:
        'Razorpay retries a webhook for 24 hours if we do not answer 2xx. If webhooks fail: 1) check the signature secret matches the dashboard; 2) look for 5xx in logs filtered by event id; 3) replay stored events from webhook_events with scripts/replay-webhooks.js. Idempotency: process each event id once (unique index on event_id). Alert if failure rate > 2% over 15 minutes.',
    },
    {
      key: 'checklist',
      title: 'UPI autopay launch checklist',
      content:
        'Before launch: bank sandbox certification from HDFC and ICICI; mandate creation and cancellation flows tested end to end; failed debit retry tested; customer notification emails approved by legal; load test at 200 mandates/minute; support team trained; feature flag upi_autopay ready for 10% rollout.',
    },
    {
      key: 'release',
      title: 'Release process',
      content:
        'Releases go out on Tuesdays and Thursdays. Every release needs: green CI, QA sign-off in the release ticket, a rollback plan, and the on-call engineer informed. Feature flags are turned on gradually: 10%, 50%, 100% with 24 hours between steps. Hotfixes can skip the schedule with lead approval.',
    },
    {
      key: 'gateway',
      title: 'Payment gateway evaluation (Sept)',
      content:
        'We compared Razorpay, Cashfree and PayU. Razorpay chosen: best UPI autopay support, clear webhook docs, 2% fee. Cashfree was cheaper (1.9%) but its mandate API was in beta. Revisit if monthly volume passes 50 lakh transactions.',
    },
  ];
  const vectors = await embedTexts('seed.embed_docs', docSpecs.map((s) => `${s.title}\n${s.content}`));
  const docs: Record<string, string> = {};
  for (const [i, s] of docSpecs.entries()) {
    const doc = await prisma.knowledgeDoc.create({ data: { title: s.title, content: s.content, embedding: vectors?.[i] ?? [] } });
    docs[s.key] = doc.id;
  }

  // ---------- Sessions ----------
  const s1 = await prisma.session.create({
    data: {
      title: 'Sprint 14 planning',
      scheduledAt: d('2026-10-14'),
      status: 'CLOSED',
      agenda: '1. UPI autopay scope\n2. Gateway choice\n3. Webhook reliability',
      notes: 'Agreed scope for UPI autopay. Razorpay confirmed. Webhooks keep failing silently on retries; need storage + replay.',
      summary: 'The team fixed the scope of UPI autopay, confirmed Razorpay as the gateway and agreed to store every webhook before processing so failures can be replayed.',
      participants: { create: ['priya', 'rahul', 'aisha', 'vikram', 'neha'].map((k) => ({ personId: P(k), attendance: 'ATTENDED' as const })) },
    },
  });
  const s2 = await prisma.session.create({
    data: {
      title: 'Payments weekly sync',
      scheduledAt: d('2026-10-21'),
      status: 'HELD',
      previousId: s1.id,
      agenda: '1. Carry-over items\n2. Mandate flow demo\n3. Load test plan',
      notes: 'Mandate creation demo worked in sandbox. Cancellation flow not started. Load test tooling picked: k6.',
      summary: 'Mandate creation works in the sandbox; cancellation is not started. The team picked k6 for load testing and kept the 1 November launch.',
      participants: {
        create: [
          { personId: P('priya'), attendance: 'ATTENDED' },
          { personId: P('rahul'), attendance: 'ATTENDED' },
          { personId: P('aisha'), attendance: 'ATTENDED' },
          { personId: P('vikram'), attendance: 'MISSED' },
          { personId: P('neha'), attendance: 'ATTENDED' },
        ],
      },
    },
  });
  const s3 = await prisma.session.create({
    data: {
      title: 'Payments weekly sync',
      scheduledAt: d('2026-10-28'),
      status: 'HELD',
      previousId: s2.id,
      agenda: '1. Launch date\n2. Bank certification status\n3. Rahul leave handover',
      notes:
        'ICICI sandbox certification is delayed by the bank, expected 10 Nov. Neha: we cannot launch without both banks. Decided to move launch to 15 Nov. Rahul is on leave from 3 Nov for three weeks; Priya takes over his webhook work.',
      summary:
        'Bank certification from ICICI is delayed to about 10 November, so the UPI autopay launch moves to 15 November. Rahul goes on leave from 3 November and hands his webhook work to Priya.',
      participants: {
        create: [
          { personId: P('priya'), attendance: 'ATTENDED' },
          { personId: P('rahul'), attendance: 'MISSED' },
          { personId: P('aisha'), attendance: 'ATTENDED' },
          { personId: P('vikram'), attendance: 'ATTENDED' },
          { personId: P('neha'), attendance: 'ATTENDED' },
        ],
      },
    },
  });
  const transfer = await prisma.session.create({
    data: {
      kind: 'TRANSFER',
      title: 'Rahul on leave: webhook work to Priya',
      scheduledAt: d('2026-11-02'),
      status: 'PLANNED',
      fromPersonId: P('rahul'),
      toPersonId: P('priya'),
      agenda: 'Walk through open webhook items, replay script, and the signature secret rotation.',
      notes: 'Rahul: replay script works locally but has not been run against staging. Secret rotation is half done; new secret is in the vault, old one still active.',
      participants: { create: [{ personId: P('rahul') }, { personId: P('priya') }] },
    },
  });
  const s4 = await prisma.session.create({
    data: {
      title: 'Payments weekly sync',
      scheduledAt: d('2026-11-04'),
      status: 'PLANNED',
      previousId: s3.id,
      agenda: '1. Open items from 28 Oct\n2. Launch readiness for 15 Nov',
      participants: { create: ['priya', 'aisha', 'vikram', 'neha'].map((k) => ({ personId: P(k) })) },
    },
  });

  // ---------- Decisions ----------
  const dec = async (sessionId: string, text: string, at: string) => prisma.decision.create({ data: { sessionId, text, createdAt: d(at) } });
  const d1 = await dec(s1.id, 'Launch UPI autopay to all customers on 1 November.', '2026-10-14');
  const d2 = await dec(s1.id, 'Use Razorpay as the payment gateway for UPI autopay.', '2026-10-14');
  const d3 = await dec(s1.id, 'Store every webhook in webhook_events before processing it.', '2026-10-14');
  await dec(s2.id, 'Use k6 for the 200 mandates/minute load test.', '2026-10-21');
  const d5 = await dec(s3.id, 'Move the UPI autopay launch to 15 November because ICICI certification is delayed.', '2026-10-28');
  await dec(s3.id, 'Priya owns webhook work while Rahul is on leave.', '2026-10-28');

  await prisma.decisionConflict.create({
    data: {
      decisionId: d5.id,
      pastDecisionId: d1.id,
      explanation: 'The 14 Oct decision set the launch for 1 November; the 28 Oct decision moves it to 15 November. Anyone working from the sprint plan still expects 1 November.',
      confidence: 0.95,
    },
  });

  // ---------- Action items with history ----------
  type Ev = { type: ItemEventType; from?: string; to?: string; at: string; sessionId: string; note?: string };
  async function item(spec: {
    title: string;
    owner: keyof typeof people | null;
    due?: string;
    status?: 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'DROPPED';
    outcome?: string;
    origin: string;
    current: string;
    events?: Ev[];
    createdAt: string;
  }) {
    const closed = spec.status === 'DONE' || spec.status === 'DROPPED';
    return prisma.actionItem.create({
      data: {
        title: spec.title,
        ownerId: spec.owner ? P(spec.owner) : null,
        dueDate: spec.due ? d(spec.due) : null,
        status: spec.status ?? 'OPEN',
        outcome: spec.outcome,
        closedAt: closed ? d(spec.events?.at(-1)?.at ?? spec.createdAt) : null,
        originSessionId: spec.origin,
        sessionId: spec.current,
        createdAt: d(spec.createdAt),
        events: {
          create: [
            { type: 'CREATED', toValue: spec.title, sessionId: spec.origin, at: d(spec.createdAt) },
            ...(spec.events ?? []).map((e) => ({ type: e.type, fromValue: e.from, toValue: e.to, sessionId: e.sessionId, note: e.note, at: d(e.at) })),
          ],
        },
      },
    });
  }

  const sprint = 'Sprint 14 planning';
  const sync21 = 'Payments weekly sync (21 Oct)';
  const sync28 = 'Payments weekly sync (28 Oct)';

  const iWebhookTable = await item({
    title: 'Create webhook_events table with unique event_id',
    owner: 'rahul', due: '2026-10-18', status: 'DONE', outcome: 'Shipped in release 3.4; duplicate events are now ignored.',
    origin: s1.id, current: s1.id, createdAt: '2026-10-14',
    events: [{ type: 'STATUS_CHANGED', from: 'OPEN', to: 'DONE', at: '2026-10-18', sessionId: s1.id }, { type: 'OUTCOME_RECORDED', to: 'Shipped in release 3.4; duplicate events are now ignored.', at: '2026-10-18', sessionId: s1.id }],
  });
  await item({
    title: 'Build mandate creation screen',
    owner: 'aisha', due: '2026-10-20', status: 'DONE', outcome: 'Demoed in sandbox on 21 Oct.',
    origin: s1.id, current: s1.id, createdAt: '2026-10-14',
    events: [{ type: 'STATUS_CHANGED', from: 'OPEN', to: 'DONE', at: '2026-10-20', sessionId: s1.id }],
  });
  const iReplay = await item({
    title: 'Write and test the webhook replay script against staging',
    owner: 'rahul', due: '2026-10-24', status: 'IN_PROGRESS',
    origin: s1.id, current: s4.id, createdAt: '2026-10-14',
    events: [
      { type: 'STATUS_CHANGED', from: 'OPEN', to: 'IN_PROGRESS', at: '2026-10-19', sessionId: s1.id },
      { type: 'CARRIED_FORWARD', from: sprint, to: sync21, at: '2026-10-21', sessionId: s2.id },
      { type: 'CARRIED_FORWARD', from: sync21, to: sync28, at: '2026-10-28', sessionId: s3.id },
      { type: 'CARRIED_FORWARD', from: sync28, to: 'Payments weekly sync (4 Nov)', at: '2026-10-29', sessionId: s4.id },
    ],
  });
  const iCancel = await item({
    title: 'Build mandate cancellation flow',
    owner: 'aisha', due: '2026-11-06', status: 'IN_PROGRESS',
    origin: s2.id, current: s4.id, createdAt: '2026-10-21',
    events: [
      { type: 'STATUS_CHANGED', from: 'OPEN', to: 'IN_PROGRESS', at: '2026-10-23', sessionId: s2.id },
      { type: 'CARRIED_FORWARD', from: sync21, to: sync28, at: '2026-10-28', sessionId: s3.id },
      { type: 'CARRIED_FORWARD', from: sync28, to: 'Payments weekly sync (4 Nov)', at: '2026-10-29', sessionId: s4.id },
    ],
  });
  const iLoad = await item({
    title: 'Run k6 load test at 200 mandates/minute',
    owner: 'vikram', due: '2026-10-27', status: 'BLOCKED',
    origin: s2.id, current: s4.id, createdAt: '2026-10-21',
    events: [
      { type: 'STATUS_CHANGED', from: 'OPEN', to: 'BLOCKED', at: '2026-10-26', sessionId: s2.id, note: 'Staging Razorpay account rate-limited' },
      { type: 'CARRIED_FORWARD', from: sync21, to: sync28, at: '2026-10-28', sessionId: s3.id },
      { type: 'CARRIED_FORWARD', from: sync28, to: 'Payments weekly sync (4 Nov)', at: '2026-10-29', sessionId: s4.id },
    ],
  });
  await item({
    title: 'Get legal approval for customer notification emails',
    owner: 'neha', due: '2026-10-25', status: 'DROPPED', outcome: 'Dropped: legal reused the approved NACH email templates, no new approval needed.',
    origin: s2.id, current: s2.id, createdAt: '2026-10-21',
    events: [{ type: 'STATUS_CHANGED', from: 'OPEN', to: 'DROPPED', at: '2026-10-24', sessionId: s2.id }],
  });
  const iCert = await item({
    title: 'Chase ICICI for sandbox certification date',
    owner: 'neha', due: '2026-11-03',
    origin: s3.id, current: s4.id, createdAt: '2026-10-28',
    events: [{ type: 'CARRIED_FORWARD', from: sync28, to: 'Payments weekly sync (4 Nov)', at: '2026-10-29', sessionId: s4.id }],
  });
  const iSecret = await item({
    title: 'Finish webhook signature secret rotation',
    owner: 'rahul', due: '2026-11-01',
    origin: transfer.id, current: transfer.id, createdAt: '2026-10-29',
  });
  await item({
    title: 'Update support FAQ with the new 15 Nov launch date',
    owner: null,
    origin: s3.id, current: s4.id, createdAt: '2026-10-28',
    events: [{ type: 'CARRIED_FORWARD', from: sync28, to: 'Payments weekly sync (4 Nov)', at: '2026-10-29', sessionId: s4.id }],
  });

  // ---------- Knowledge links (what the AI linker produces) ----------
  const link = (docId: string, reason: string, score: number, t: { itemId?: string; decisionId?: string }) =>
    prisma.knowledgeLink.create({ data: { docId, reason, score, ...t } });
  await link(docs.runbook, 'The runbook describes the replay script and how to filter failed events by id.', 0.92, { itemId: iReplay.id });
  await link(docs.arch, 'Explains that webhooks are stored in webhook_events and signed with RAZORPAY_WEBHOOK_SECRET.', 0.8, { itemId: iSecret.id });
  await link(docs.runbook, 'Step 1 of the runbook covers checking the signature secret, which the rotation changes.', 0.75, { itemId: iSecret.id });
  await link(docs.checklist, 'The launch checklist requires a load test at 200 mandates/minute.', 0.9, { itemId: iLoad.id });
  await link(docs.checklist, 'Cancellation flow must be tested end to end before launch.', 0.85, { itemId: iCancel.id });
  await link(docs.checklist, 'Bank sandbox certification from HDFC and ICICI is a launch prerequisite.', 0.88, { itemId: iCert.id });
  await link(docs.gateway, 'Records why Razorpay was chosen over Cashfree and PayU.', 0.95, { decisionId: d2.id });
  await link(docs.runbook, 'The runbook relies on stored events to replay failures.', 0.82, { decisionId: d3.id });
  await link(docs.release, 'Launch dates follow the gradual feature-flag rollout in the release process.', 0.6, { decisionId: d5.id });
  void iWebhookTable;

  // Past held sessions become knowledge docs too.
  for (const s of [s1, s2, s3]) {
    const full = await prisma.session.findUniqueOrThrow({ where: { id: s.id }, include: { decisions: true } });
    await prisma.knowledgeDoc.create({
      data: {
        title: `${full.title} (${full.scheduledAt.toISOString().slice(0, 10)})`,
        content: `Summary: ${full.summary}\n\nDecisions:\n${full.decisions.map((x) => `- ${x.text}`).join('\n')}`,
        source: 'MEETING',
        sessionId: s.id,
        embedding: [],
      },
    });
  }

  console.log(`Seeded: ${Object.keys(people).length} people, 5 sessions, ${docSpecs.length + 3} docs, 1 conflict.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
