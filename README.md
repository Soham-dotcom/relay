# Relay

**AI-powered knowledge and task hand-over for teams.** Relay captures what was discussed and decided in a meeting or a work transfer, hands that context to the right people, and follows every action item until it is closed with an outcome.

> **Live demo: https://relay-h9qf.onrender.com**. Pick a demo person on the sign-in screen (no password) and switch people to see the access rules work. The free tier sleeps when idle, so the first request can take ~30-50 s.

Teams lose context every time work changes hands: someone misses a meeting, a colleague goes on leave, last week's action item never reaches this week's agenda. Relay is built around those three moments.

| You want to… | Relay does it with |
|---|---|
| Record a meeting or hand-over | **Sessions**: a meeting or a work transfer (from → to person), with agenda, participants (attended / missed), notes, decisions and action items |
| Turn messy notes into structure | **AI recap**: paste notes, a chat, an email thread or a transcript → summary, decisions, action items with owners and due dates. You review and edit the draft before anything is saved |
| Catch up after missing it / take over | **AI catch-up brief**, personalised to the reader: your actions, key decisions, other open items, what to watch out for |
| Never lose an open item | **Lifecycle tracking**: Open → In progress → Blocked → Done / Dropped, with owner and due date. **Carry forward** moves open items to the next session and keeps their full history. An item cannot be closed without an **outcome** |
| Find the background | **Knowledge base**: team documents + every held meeting. AI links items and decisions to the documents that help, and says why |
| ★ Avoid acting on a reversed decision | **Decision conflict check** (special feature, below) |
| Share the right context with the right people | **Access control**: every session and document is 🔒 Private, 👥 Team or 🌐 Organisation. The server enforces it on every query, and the AI respects it too (below) |

## ★ Special feature: decision conflict check

**The problem.** Decisions get quietly reversed. On 14 Oct the team decides *"launch on 1 November"*; on 28 Oct, in a meeting Rahul missed, they decide *"launch moves to 15 November"*. The sprint plan, Rahul's notes and the support FAQ still say 1 November. Nothing in a normal tracker connects those two sentences, so people keep working from the old decision.

**What Relay does.** Every time a recap is saved, each new decision is compared with the most related earlier decisions. The AI judges whether they really contradict (not just "talk about the same thing"), explains the clash, and gives a confidence. Conflicts show up:
- on the decision itself, with a link to the meeting where the older decision was made;
- in the **Conflicts** page (with a count in the header), where someone marks it *resolved* (with a note) or *not a conflict*;
- in every catch-up brief under **Watch out**, so a person who missed the meeting is told the old decision is outdated.

**Why it adds value.** Missed meetings and hand-overs are exactly where a reversed decision hurts most, and they are the two situations this assignment is about. Tracking tasks is common; tracking whether the *decisions behind the tasks* still hold is not.

**How it stays reliable.** Two stages: cheap retrieval (embeddings, or keyword overlap if embeddings fail) picks the 5 most related earlier decisions, and only those pairs go to the model. The model can only answer about ids it was sent (any other id is dropped), and only conflicts with confidence ≥ 0.6 are stored. With no AI available, Relay stores **no** conflicts rather than guessing with rules: a false alarm costs more trust than a missed one.

The seeded demo already contains this conflict (Payments weekly sync, 28 Oct).

## Access control: the right context for the right people

Handing context over is only safe if it doesn't hand it to the wrong people. A leave hand-over or a 1-on-1 is private; a squad's weekly sync is for the squad; a release process is for everyone.

| Level | Who can see it | Demo example |
|---|---|---|
| 🔒 Private | Session: its participants. Document: its author | Rahul's leave hand-over to Priya; Rahul's private hand-over notes |
| 👥 Team | Members of the owning team (plus the session's participants) | Payments weekly syncs; Support weekly triage |
| 🌐 Organisation | Everyone | "Release process", "Customer escalation policy" |

Action items follow their session, and **people always see their own items**, even from a session they can't open. Visibility is chosen when a session or document is created and can't be changed later (see below for why).

**Sign-in.** A demo picker ("sign in as Priya / Kavya / …") issues a signed JWT (HS256, 8 h). The browser sends it as a Bearer header; every `/api` route except health and sign-in requires it. The user and their teams are re-read from the database on each request, so a team change applies immediately. A real deployment would swap the picker for SSO; nothing else changes.

**Enforced on the server, not the screen.** All rules live in one file (`server/src/access.ts`):
- three query filters (`sessionWhere`, `docWhere`, `itemWhere`) that every list, detail, search and item query adds;
- guards on every session/item/document/conflict route. A record you can't see returns **404, not 403**, so its existence isn't revealed, and an `access.denied` event is logged with the viewer and the resource.

**The AI respects it too.** This is the subtle part: the AI combines records, and a combination can leak.
- **Catch-up brief:** the fact sheet sent to the model only contains what both the person asking and the reader can see. A brief for someone who can't see the session is refused (`READER_NO_ACCESS`).
- **Knowledge linking:** a document is only a candidate if *everyone who can see the item can also see the document*. Otherwise a private doc's title and the AI's reason would appear on a team item.
- **Conflict check:** a new decision is only compared with earlier decisions its whole audience can see. Otherwise the explanation would quote a private decision to the team.
- Because links and conflicts are created audience-safe and visibility can't change afterwards, showing them later needs no extra checks. Org-wide documents still filter their "linked to" list per viewer, since an org doc can be linked to a team decision.

Try it: sign in as **Aisha** (Payments: 4 sessions), **Kavya** (Support: only the support triage plus the 2 org documents), **Neha** (in both teams: sees both), or **Rahul** / **Priya** (the only ones who see the private hand-over).

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js 22, TypeScript, Express 5, zod validation |
| Database | PostgreSQL via Prisma ORM (Neon in production, embedded Postgres locally) |
| AI | Google Gemini (`gemini-2.5-flash` for text, `gemini-embedding-001` for embeddings) behind a small provider interface |
| Logging | pino (JSON) to stdout and `logs/app.log`, pino-http access logs |
| Frontend | React 19, Vite, Tailwind CSS 4, TanStack Query, React Router |
| Tests | Vitest + Supertest, real Postgres, fake AI provider |
| Deploy / CI | One Render web service (API serves the built UI) + Neon Postgres; GitHub Actions |

## Run it locally

Requirements: Node.js 20+. No Docker or Postgres install needed.

```bash
# 1. Install
npm run install:all

# 2. Start a local Postgres on port 5433 (leave this running in its own terminal)
cd server
npm run db:local

# 3. In a second terminal: configure, create tables, load demo data
cd server
cp .env.example .env          # then paste your Gemini key into GEMINI_API_KEY (optional)
npx prisma migrate deploy
npm run db:seed

# 4. Run the API (port 4000) and the UI (port 5173, proxies /api to 4000)
npm run dev                   # in server/
npm run dev --prefix ../web   # in another terminal
```

Open http://localhost:5173. To run it the way production does (one port): `npm run build` at the root, then `npm start --prefix server` and open http://localhost:4000.

### Tests

```bash
cd server
npm test          # 27 tests: unit + API tests against the relay_test database (needs `npm run db:local`)
npm run typecheck
```

The AI is replaced by a scripted fake in tests, so they are fast, free and deterministic. They cover validation errors, the outcome-required rule, carry-forward history, recap drafting and owner matching, recognising already-open items instead of duplicating them, AI retry and failure, the fallback brief, and the conflict check rejecting invented ids and low-confidence answers.

Nine access-control tests check: no token → 401; a private session is a 404 for a teammate outside it (and every action on it is guarded); team sessions are invisible to other teams while org sessions are visible to all; you can't create for a team you're not in; owners always see their own items; org / team / private documents per person; **the brief never includes items the requester can't see**, and can't be written for a reader without access; **knowledge linking never suggests a doc the item's audience can't see**; **the conflict prompt never contains a decision outside the audience**.

## AI configuration

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | _(empty)_ | Free key from https://aistudio.google.com/apikey. Empty = AI off, app still works |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Text model for recap, brief, linking, conflicts |
| `GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Embeddings (768 dims) for retrieval |
| `AI_TIMEOUT_MS` | `25000` | Per-call timeout |

**Where AI is used**

| Feature | Input | Output (validated with zod) |
|---|---|---|
| Recap | raw text + participants + agenda + meeting date + the session's already-open items | summary, decisions, action items (title, owner, ISO due date, supporting quote, id of the open item it refers to) |
| Catch-up brief | a JSON fact sheet of the session (with today's date and an `overdue` flag per item), built by the server | headline, summary, your actions, open items, watch-outs |
| Knowledge linking | each item/decision + its top 4 candidate docs | links with a one-sentence reason and a relevance score |
| Conflict check | each new decision + its 5 most related earlier decisions | conflicting pairs with explanation and confidence |

**Reliability rules (in `server/src/ai/`)**
- Every prompt says: use only the given input, never invent people or dates, reply in one exact JSON shape.
- Every reply is parsed and validated against a zod schema. If invalid, Relay retries **once** with the validation error in the prompt, then fails with `503 AI_UNAVAILABLE`.
- The model never writes to the database directly. The recap is a **draft** the user edits and confirms. Owner names are matched to real participants (full name, then a unique first name); an unmatched name is shown as a warning, never guessed.
- **No duplicate items.** Notes usually repeat last week's open work ("Vikram will run the load test by Thursday"). The recap sees the session's open items and returns the id of the one a note refers to; saving then updates that item's owner/due date (recorded in its history) instead of creating a copy. The user can override this in the draft.
- The model can only reference ids it was given. Anything else is dropped and logged.
- Relative dates ("by tomorrow") resolve from the **meeting date**; "overdue" is computed by the server from the real date and passed to the model as a flag, never left to the model to judge.
- **Verified live** against Gemini on 2026-10-30: a messy 7-line note produced the right decision, owners, due dates and quotes; it matched 2 of 3 tasks to existing open items; the conflict check flagged "switch to Cashfree" against the earlier "use Razorpay" (confidence 1.0). One Gemini `503 high demand` reply during testing was recovered by the automatic retry.
- **Graceful degradation** when AI is off or failing: manual recap entry still works; the catch-up brief is built straight from the data (marked "AI unavailable"); knowledge linking falls back to keyword matching; the conflict check is skipped and the user is told.
- The provider sits behind a two-method interface (`generateText`, `embed`), so switching to Claude or OpenAI is one new class.

## Data

- **Schema** (`server/prisma/schema.prisma`): `Person`, `Team` + `TeamMember`, `Session` (meeting or transfer, with `visibility` + owning `teamId`, and `previousId` forming a chain), `Participant` (attendance), `Decision`, `ActionItem` (owner, due date, status, outcome, origin session and current session), `ItemEvent` (append-only history), `KnowledgeDoc` (with embedding, `visibility`, `teamId`, author), `KnowledgeLink` (with AI reason), `DecisionConflict`.
- **History is append-only.** Every create, status change, reassignment, due-date change, carry-forward and outcome writes an `ItemEvent`, so an item's whole life can be replayed.
- **Integrity rules in the service layer:** an item can't close without an outcome (422); a session can't close with open items (409); a transfer needs two different people; people and sessions must exist (400/404). Multi-row changes run in transactions.
- **Demo data** (`npm run db:seed`): two teams. **Payments squad** (5 people): three weekly syncs, a planned next sync, and a **private** work transfer (Rahul going on leave, visible only to Rahul and Priya). **Customer support** (Kavya, Arjun): a weekly triage only they can see. Neha (product) is in both teams. It includes items carried forward three times, an overdue blocked item, closed items with outcomes, a dropped item with its reason, an unassigned item, 8 documents (team, org-wide and one private draft) with links, and the launch-date conflict.

## Logging

- **Library:** pino, JSON lines, written to **stdout and `server/logs/app.log`** (`LOG_FILE`).
- **Levels:** `info` for normal events, `warn` for rejected requests (4xx) and AI retries/fallbacks, `error` for 5xx and AI giving up. `LOG_LEVEL` sets the minimum.
- **Correlation ID:** each request gets an `x-request-id` (the caller's, if it is safe, else a UUID). It is returned in the response header and in every error body, and an AsyncLocalStorage mixin stamps it on **every log line** written during that request, including AI calls and service events. Once signed in, every line also carries the `userId`.
- **Security events:** `auth.login`, `auth.invalid_token`, and `access.denied` (warn) with the viewer, resource type and id whenever someone asks for a record they can't see.
- **Key events** (field `event`): `session.created`, `session.status_changed`, `item.created`, `item.reassigned`, `item.status_changed`, `item.closed`, `items.carried_forward`, `recap.applied`, `kb.doc_created`, `kb.linked`, `conflict.detected`, `conflict.updated`, `brief.generated`.
- **AI calls** (`event: ai.call` / `ai.embed`): operation, model, attempt, `latencyMs`, `outcome` (`ok`, `invalid_output`, `error`).
- **Errors** are logged with the stack, status, code, method and path.
- **No secrets:** request bodies are never logged; auth headers, cookies, API keys and the database URL are redacted.

Example line:
```json
{"level":30,"time":"2026-10-30T06:32:13.765Z","service":"relay-api","requestId":"8b62fec5-…","event":"ai.call","op":"recap.draft","model":"gemini-2.5-flash","attempt":1,"latencyMs":2140,"outcome":"ok","msg":"AI call succeeded"}
```

## API

All endpoints are under `/api`. Errors always look like `{ "error": { "code", "message", "details?", "requestId" } }`. Everything except health and the two sign-in routes needs `Authorization: Bearer <token>` (401 otherwise), and returns only what that user may see.

| Method & path | Purpose |
|---|---|
| `GET /health` | DB check + whether AI is configured (public) |
| `GET /auth/people`, `POST /auth/login` | Demo sign-in: list people / get a signed token for one (public) |
| `GET /auth/me` | The signed-in user and their teams |
| `GET/POST /people` | List / add people |
| `GET/POST /sessions` | List (filter `kind`, `status`) / create (`visibility`, `teamId`, optionally `carryFromId`, initial `actionItems`) |
| `GET/PATCH/DELETE /sessions/:id` | Detail / update (title, date, status, agenda, notes) / delete |
| `PUT/DELETE /sessions/:id/participants/:personId` | Set attendance / remove |
| `POST /sessions/:id/items` | Add an action item |
| `POST /sessions/:id/carry-forward` | Move open items to `toSessionId` |
| `POST /sessions/:id/transfer-items` | Work transfer: reassign all the leaver's open items |
| `POST /sessions/:id/recap/draft` | AI recap draft from `raw` text (nothing saved) |
| `POST /sessions/:id/recap/apply` | Save reviewed recap, then link to knowledge + check conflicts |
| `POST /sessions/:id/brief` | Catch-up brief, optional `readerId` |
| `GET /items`, `GET/PATCH /items/:id` | List (filter `open`, `overdue`, `status`, `ownerId`) / detail / update |
| `POST /items/:id/link` | Re-run AI knowledge linking for one item |
| `GET/POST /knowledge`, `DELETE /knowledge/:id` | Knowledge base |
| `GET /conflicts`, `PATCH /conflicts/:id` | List / resolve or dismiss |

## Approach

1. **Model the hand-over, not just the meeting.** A work transfer is the same kind of record as a meeting (one `Session` table with a `kind`), so carry-forward, briefs, history and conflicts work for both with no duplicate code.
2. **AI proposes, people decide.** The recap is a draft, owners are matched to real people, links and conflicts come with reasons the user can read and dismiss.
3. **The database is the source of truth, the AI only reads it.** The brief is generated from a fact sheet the server builds, so it can't mention things that aren't recorded, and the same fact sheet produces the no-AI fallback.
4. **Retrieve, then reason.** For linking and conflicts, cheap retrieval narrows the field and the model only judges a few candidates. That keeps prompts small, cost low, and the model's choices checkable.
5. **One deployable.** Express serves the built React app, so production is one service and one URL, with no CORS.
6. **Access is a server rule, and the AI is a reader like any other.** Every query filters by what the user can see, and every AI prompt is built only from what its audience can see.

Layout: `server/src/routes.ts` (HTTP + validation) → `server/src/services/*` (business rules, transactions, events) → Prisma. AI code lives in `server/src/ai/` (provider, client with retry/validation/logging, prompts and schemas).

## Assumptions

- Demo sign-in: anyone can sign in as any demo person (that's the point of the demo). Inside a team everyone may edit the team's sessions; there are no per-person edit roles.
- People are a small team list managed in the app. Email invites and calendars are out of scope; "missed" is recorded by hand.
- Unstructured input arrives as pasted text (notes, chat, email, transcript). A recording must be transcribed first.
- Dates are calendar dates; times and time zones are not modelled.

## Known limitations

- **Demo sign-in, not real authentication.** The JWT, the server-side checks and the audience rules are real, but the picker lets anyone become anyone. Production would put SSO (Google / Microsoft) in front of `POST /auth/login`.
- **Visibility is fixed at creation** (by design: AI links and conflicts were computed for the original audience). Changing it would need those to be re-checked.
- **No edit roles.** Anyone who can see a session can edit it; a team admin role would be the next step.
- **No audio upload / transcription**, and no Slack/Gmail/Calendar connectors; input is pasted text.
- **Retrieval is in-memory.** Embeddings are stored in Postgres but compared in Node, which is fine for hundreds of documents. At scale, move to `pgvector` with an index.
- **AI quality is not measured with a labelled set.** Outputs are schema-checked and reviewed by the user, but there is no accuracy number yet.
- **No reminders are sent.** Follow-up happens through overdue/carried flags, the Action items board and briefs, not email or chat notifications.
- **Free hosting:** the Render free tier sleeps after ~15 min idle (first request ~30 s), and its disk is wiped on redeploy, so `logs/app.log` there is per-instance. In production you would ship logs to a log service.
- The AI recap and follow-ups run inside the request (a few seconds). A job queue would make this asynchronous.

## Deploy (Render + Neon)

1. **Neon:** create a project at https://neon.tech and copy the connection string (use the *direct* connection, not the `-pooler` host, so Prisma migrations work).
2. **Render:** New → Blueprint → pick this repo. `render.yaml` defines one web service. Set `DATABASE_URL` (Neon) and `GEMINI_API_KEY`; Render generates `JWT_SECRET` (required when `NODE_ENV=production`).
3. The start command runs `prisma migrate deploy` and then the server. To load the demo data once, run from your machine: `DATABASE_URL=<neon url> npm run db:seed --prefix server`.
4. Health check: `GET /api/health`.
