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
    prisma.teamMember.deleteMany(),
    prisma.team.deleteMany(),
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
        ['kavya', 'Kavya Nair', 'Support lead'],
        ['arjun', 'Arjun Das', 'Support engineer'],
      ].map(async ([key, name, role]) => [key, await prisma.person.create({ data: { name, role, email: `${key}@payflow.dev` } })] as const),
    ),
  );
  const P = (k: keyof typeof people) => people[k].id;

  // ---------- Teams: Neha (product) sits in both, everyone else in one ----------
  const team = async (name: string, keys: (keyof typeof people)[]) =>
    (await prisma.team.create({ data: { name, members: { create: keys.map((k) => ({ personId: P(k) })) } } })).id;
  const payments = await team('Payments squad', ['priya', 'rahul', 'aisha', 'vikram', 'neha']);
  const support = await team('Customer support', ['kavya', 'arjun', 'neha']);
  const paymentsTeam = { visibility: 'TEAM' as const, teamId: payments };

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
    {
      key: 'macro',
      title: 'Support macro: failed autopay debit',
      content:
        'Use when a customer reports a failed UPI autopay debit. Apologise, confirm the mandate is still active, explain that the bank retries once after 24 hours, and that any amount debited without a successful payment is refunded within 3 working days. Escalate to Payments on-call if the same customer fails twice in a week.',
    },
    {
      key: 'escalation',
      title: 'Customer escalation policy',
      content:
        'Severity 1 (money taken, service not given): page Payments on-call within 15 minutes, update the customer every 2 hours. Severity 2 (feature broken, no money impact): ticket to the owning team, reply within 1 working day. All escalations are logged in the escalation tracker.',
    },
    {
      key: 'rahulNotes',
      title: "Rahul's hand-over notes (private draft)",
      content:
        'Personal notes before leave. The new webhook secret is in the vault under payments/razorpay/webhook-v2; the old one must stay active until Razorpay confirms the switch. The replay script needs STAGING_DB_URL set. Ask Vikram for the k6 staging token.',
    },
    {
      key: 'postmortem',
      title: 'Postmortem: webhook outage on 2 October',
      content:
        'For 47 minutes on 2 Oct, payment.captured webhooks failed with 500s because a deploy rotated RAZORPAY_WEBHOOK_SECRET without updating the dashboard. 312 orders stayed "pending". Root cause: secret rotation was a manual two-step change with no check. Fixes: store every webhook before processing (done), a replay script for failed events, alert when the webhook failure rate passes 2% over 15 minutes, and a rotation runbook that keeps the old secret active until the new one is confirmed.',
    },
    {
      key: 'onboarding',
      title: 'Engineering onboarding guide',
      content:
        'Week 1: get access to GitHub, the staging environment and the on-call rota; read the payments architecture and the release process. Week 2: ship one small fix with a buddy. Every engineer joins on-call after 6 weeks. Hand-overs before leave must list open items, credentials in the vault (never in notes) and who to ask.',
    },
    {
      key: 'refundPolicy',
      title: 'Refund policy and SLAs',
      content:
        'Failed autopay debits: refund within 3 working days, automatically. Duplicate charges: refund within 24 hours after confirmation. Refunds above 10,000 rupees need a payments lead approval. Every refund promise made to a customer must match this policy.',
    },
  ];
  // Who can see each document: most are team docs, two are company-wide, one is Rahul's private draft.
  const docScope: Record<string, { visibility: 'PRIVATE' | 'TEAM' | 'ORG'; teamId: string | null; createdById: string }> = {
    arch: { ...paymentsTeam, createdById: P('rahul') },
    runbook: { ...paymentsTeam, createdById: P('rahul') },
    checklist: { ...paymentsTeam, createdById: P('neha') },
    release: { visibility: 'ORG', teamId: null, createdById: P('priya') },
    gateway: { ...paymentsTeam, createdById: P('priya') },
    macro: { visibility: 'TEAM', teamId: support, createdById: P('kavya') },
    escalation: { visibility: 'ORG', teamId: null, createdById: P('kavya') },
    rahulNotes: { visibility: 'PRIVATE', teamId: null, createdById: P('rahul') },
    postmortem: { ...paymentsTeam, createdById: P('rahul') },
    onboarding: { visibility: 'ORG', teamId: null, createdById: P('priya') },
    refundPolicy: { visibility: 'ORG', teamId: null, createdById: P('neha') },
  };
  const vectors = await embedTexts('seed.embed_docs', docSpecs.map((s) => `${s.title}\n${s.content}`));
  const docs: Record<string, string> = {};
  for (const [i, s] of docSpecs.entries()) {
    const doc = await prisma.knowledgeDoc.create({ data: { title: s.title, content: s.content, embedding: vectors?.[i] ?? [], ...docScope[s.key] } });
    docs[s.key] = doc.id;
  }

  // ---------- Sessions ----------
  const s1 = await prisma.session.create({
    data: {
      title: 'Sprint 14 planning',
      scheduledAt: d('2026-10-14'),
      status: 'CLOSED',
      ...paymentsTeam,
      createdById: P('priya'),
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
      ...paymentsTeam,
      createdById: P('priya'),
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
      ...paymentsTeam,
      createdById: P('priya'),
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
      // Private: a leave hand-over is between the two people involved.
      visibility: 'PRIVATE',
      teamId: payments,
      createdById: P('rahul'),
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
      ...paymentsTeam,
      createdById: P('priya'),
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

  // ---------- Customer support team: invisible to people only in Payments ----------
  const triage = await prisma.session.create({
    data: {
      title: 'Support weekly triage',
      scheduledAt: d('2026-10-27'),
      status: 'HELD',
      visibility: 'TEAM',
      teamId: support,
      createdById: P('kavya'),
      agenda: '1. Failed autopay debit tickets\n2. Launch communication',
      notes: '14 tickets about failed autopay debits this week. Agreed a standard refund promise. Arjun drafts the macro.',
      summary: 'Support saw 14 failed autopay debit tickets this week and agreed to promise customers a refund within 3 working days. Arjun will publish a support macro.',
      participants: {
        create: [
          { personId: P('kavya'), attendance: 'ATTENDED' },
          { personId: P('arjun'), attendance: 'ATTENDED' },
          { personId: P('neha'), attendance: 'MISSED' },
        ],
      },
    },
  });
  await dec(triage.id, 'Promise customers a refund within 3 working days for any failed autopay debit.', '2026-10-27');
  // Support's next triage: open items from 27 Oct were carried into it.
  const triage2 = await prisma.session.create({
    data: {
      title: 'Support weekly triage',
      scheduledAt: d('2026-11-03'),
      status: 'PLANNED',
      visibility: 'TEAM',
      teamId: support,
      createdById: P('kavya'),
      previousId: triage.id,
      agenda: '1. Open items from 27 Oct\n2. Launch-day staffing for 15 Nov',
      participants: { create: ['kavya', 'arjun', 'neha'].map((k) => ({ personId: P(k) })) },
    },
  });
  const triageTitle = 'Support weekly triage (27 Oct)';
  const triage2Title = 'Support weekly triage (3 Nov)';
  const iMacro = await item({
    title: 'Publish the failed-debit support macro',
    owner: 'arjun', due: '2026-10-31',
    origin: triage.id, current: triage2.id, createdAt: '2026-10-27',
    events: [{ type: 'CARRIED_FORWARD', from: triageTitle, to: triage2Title, at: '2026-10-29', sessionId: triage2.id }],
  });
  await item({
    title: 'Brief the support team on the 15 Nov launch date',
    owner: 'kavya', due: '2026-11-07',
    origin: triage.id, current: triage2.id, createdAt: '2026-10-28',
    events: [{ type: 'CARRIED_FORWARD', from: triageTitle, to: triage2Title, at: '2026-10-29', sessionId: triage2.id }],
  });
  await item({
    title: 'Tag all failed-debit tickets with "autopay-failed"',
    owner: 'arjun', due: '2026-10-28', status: 'DONE', outcome: 'Done: 14 tickets tagged; the tag now feeds the weekly report.',
    origin: triage.id, current: triage.id, createdAt: '2026-10-27',
    events: [{ type: 'STATUS_CHANGED', from: 'OPEN', to: 'DONE', at: '2026-10-28', sessionId: triage.id }],
  });
  await link(docs.macro, 'This is the macro the item publishes: wording, refund promise and when to escalate.', 0.95, { itemId: iMacro.id });
  await link(docs.escalation, 'Defines when a failed debit must be escalated to Payments on-call.', 0.7, { itemId: iMacro.id });
  await link(docs.refundPolicy, 'The macro must promise exactly the refund times in the policy (3 working days for failed debits).', 0.9, { itemId: iMacro.id });

  // Private 1-on-1 inside Support: only Kavya and Arjun see it.
  const oneOnOne = await prisma.session.create({
    data: {
      title: 'Kavya / Arjun 1-on-1',
      scheduledAt: d('2026-10-29'),
      status: 'HELD',
      visibility: 'PRIVATE',
      teamId: support,
      createdById: P('kavya'),
      notes: 'Arjun wants to move towards payments escalations. Agreed he shadows on-call.',
      summary: 'Arjun wants more payments exposure; he will shadow three escalations with Payments on-call before taking any alone.',
      participants: { create: [{ personId: P('kavya'), attendance: 'ATTENDED' }, { personId: P('arjun'), attendance: 'ATTENDED' }] },
    },
  });
  await item({ title: 'Shadow three escalations with Payments on-call', owner: 'arjun', due: '2026-11-20', origin: oneOnOne.id, current: oneOnOne.id, createdAt: '2026-10-29' });

  // Company all-hands: everyone sees it. Its launch date is later contradicted by Payments.
  const allHands = await prisma.session.create({
    data: {
      title: 'Company all-hands: Q4 priorities',
      scheduledAt: d('2026-10-16'),
      status: 'HELD',
      visibility: 'ORG',
      teamId: null,
      createdById: P('neha'),
      agenda: '1. Q4 goals\n2. UPI autopay launch\n3. Support readiness',
      notes: 'Neha presented Q4 goals. UPI autopay launch announced for 1 November. Support asked for earlier notice on launches.',
      summary: 'Q4 focus is UPI autopay. The launch was announced to the whole company for 1 November, and every customer-facing launch now needs a support briefing a week before.',
      participants: { create: ['neha', 'priya', 'kavya'].map((k) => ({ personId: P(k), attendance: 'ATTENDED' as const })) },
    },
  });
  const dAllHands = await dec(allHands.id, 'UPI autopay goes live for all customers on 1 November (company announcement).', '2026-10-16');
  const dBriefing = await dec(allHands.id, 'Every customer-facing launch needs a support briefing one week before go-live.', '2026-10-16');
  await item({
    title: 'Publish the customer FAQ for UPI autopay',
    owner: 'neha', due: '2026-10-30', status: 'IN_PROGRESS',
    origin: allHands.id, current: allHands.id, createdAt: '2026-10-16',
    events: [{ type: 'STATUS_CHANGED', from: 'OPEN', to: 'IN_PROGRESS', at: '2026-10-22', sessionId: allHands.id }],
  });
  await link(docs.release, 'Launch announcements follow the release process and its gradual feature-flag rollout.', 0.65, { decisionId: dAllHands.id });
  await link(docs.escalation, 'Support briefings should cover the escalation path for the new feature.', 0.6, { decisionId: dBriefing.id });
  // The org-wide announcement is visible to everyone who sees the Payments sync, so this pair may be compared.
  await prisma.decisionConflict.create({
    data: {
      decisionId: d5.id,
      pastDecisionId: dAllHands.id,
      explanation:
        'The whole company was told on 16 Oct that UPI autopay goes live on 1 November; Payments moved it to 15 November on 28 Oct. Support and anyone outside Payments still expects 1 November.',
      confidence: 0.92,
    },
  });

  // Older Payments retro: closed items with outcomes, so history goes back further.
  const retro = await prisma.session.create({
    data: {
      title: 'Sprint 13 retro',
      scheduledAt: d('2026-10-07'),
      status: 'CLOSED',
      ...paymentsTeam,
      createdById: P('priya'),
      notes: 'Webhook outage on 2 Oct dominated. Agreed fixes from the postmortem.',
      summary: 'The retro focused on the 2 Oct webhook outage. The team agreed to store webhooks before processing and to add an alert on webhook failures.',
      participants: { create: ['priya', 'rahul', 'aisha', 'vikram', 'neha'].map((k) => ({ personId: P(k), attendance: 'ATTENDED' as const })) },
    },
  });
  await prisma.session.update({ where: { id: s1.id }, data: { previousId: retro.id } });
  await dec(retro.id, 'Alert when the webhook failure rate passes 2% over 15 minutes.', '2026-10-07');
  const iAlert = await item({
    title: 'Add webhook failure-rate alert',
    owner: 'vikram', due: '2026-10-10', status: 'DONE', outcome: 'Alert live in Grafana; tested by forcing failures on staging.',
    origin: retro.id, current: retro.id, createdAt: '2026-10-07',
    events: [
      { type: 'STATUS_CHANGED', from: 'OPEN', to: 'DONE', at: '2026-10-10', sessionId: retro.id },
      { type: 'OUTCOME_RECORDED', to: 'Alert live in Grafana; tested by forcing failures on staging.', at: '2026-10-10', sessionId: retro.id },
    ],
  });
  await item({
    title: 'Write the secret-rotation runbook',
    owner: 'rahul', due: '2026-10-11', status: 'DROPPED', outcome: 'Dropped: folded into the webhook runbook (step 1) instead of a separate document.',
    origin: retro.id, current: retro.id, createdAt: '2026-10-07',
    events: [{ type: 'STATUS_CHANGED', from: 'OPEN', to: 'DROPPED', at: '2026-10-12', sessionId: retro.id }],
  });
  await link(docs.postmortem, 'The postmortem sets the 2%/15-minute alert threshold this item implements.', 0.93, { itemId: iAlert.id });
  await link(docs.postmortem, 'Background: the 2 Oct outage was caused by a secret rotation, which is what this work finishes.', 0.85, { itemId: iSecret.id });

  // Past held sessions become knowledge docs too; access follows the session.
  for (const s of [retro, allHands, s1, s2, s3, triage, oneOnOne]) {
    const full = await prisma.session.findUniqueOrThrow({ where: { id: s.id }, include: { decisions: true } });
    await prisma.knowledgeDoc.create({
      data: {
        title: `${full.title} (${full.scheduledAt.toISOString().slice(0, 10)})`,
        content: `Summary: ${full.summary}\n\nDecisions:\n${full.decisions.map((x) => `- ${x.text}`).join('\n')}`,
        source: 'MEETING',
        sessionId: s.id,
        visibility: full.visibility,
        teamId: full.teamId,
        createdById: full.createdById,
        embedding: [],
      },
    });
  }

  console.log(`Seeded: ${Object.keys(people).length} people, 2 teams, 10 sessions, ${docSpecs.length + 7} docs, 2 conflicts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
