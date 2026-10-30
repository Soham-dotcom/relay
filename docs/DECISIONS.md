# Decisions

Each entry: what was chosen, why, what was rejected, and the trade-off accepted.

### D1. One `Session` table for meetings and work transfers
- **Why:** both need agenda, participants, notes, decisions, items, carry-forward and briefs. One table means one code path.
- **Rejected:** separate `Meeting` and `Handover` tables (duplicated services and UI).
- **Trade-off:** transfer-only fields (`fromPersonId`, `toPersonId`) are nullable and checked in the service, not by the schema.

### D2. Items move between sessions; history is an append-only `ItemEvent` log
- **Why:** "carry forward, keeping history" means the same item continues, not a copy. `originSessionId` keeps where it was raised; events record every change.
- **Rejected:** copying the item into each meeting (history splits, counts double).
- **Trade-off:** reading an item's past needs the events join; acceptable at this size.

### D3. AI recap is a draft the user confirms
- **Why:** reliability. A model can mis-hear an owner or invent a date; a human check before saving costs one click.
- **Rejected:** saving AI output directly (fast, but silently wrong data).
- **Trade-off:** one extra step for the user.

### D4. zod-validated JSON + one retry, then `503 AI_UNAVAILABLE`
- **Why:** model output is untrusted input. The retry includes the validation error, which fixes most bad replies; more retries mostly add latency.
- **Rejected:** trusting `responseMimeType: json` alone; unlimited retries.
- **Trade-off:** a rare valid-but-wrong answer still gets through; the user review (D3) is the second guard.

### D5. Gemini behind a two-method `AiProvider` interface
- **Why:** free key with no card (fits a student budget), text and embeddings from one key. The interface keeps the provider swappable and lets tests inject a fake.
- **Rejected:** Claude/OpenAI (need prepaid credit); LangChain (heavy for four calls).
- **Trade-off:** free-tier rate limits; lower quality than the top paid models.

### D6. Retrieve, then let the model judge (linking and conflicts)
- **Why:** sending the whole knowledge base or every past decision to the model is slow, costly and less accurate. Embeddings narrow to 4–5 candidates; the model explains its choice; ids are checked against what was sent.
- **Rejected:** pure embedding similarity (no reasons, many false links); pure LLM over everything.
- **Trade-off:** a relevant doc outside the top candidates is missed.

### D7. Embeddings stored in Postgres `Float[]`, compared in Node
- **Why:** no extra service, nothing to install on Neon; fast enough for hundreds of docs.
- **Rejected:** pgvector or a vector DB (worth it at scale, not for a demo).
- **Trade-off:** O(n) scan per query. Upgrade path: pgvector + HNSW index.

### D8. Conflict check stores nothing without AI
- **Why:** a rule-based "same words = conflict" would raise false alarms and teach users to ignore the feature.
- **Rejected:** keyword-based conflict fallback.
- **Trade-off:** with AI down, conflicts are missed (the user is told the check was skipped).

### D9. Fallback brief built from the same fact sheet
- **Why:** the person catching up still gets correct facts when AI fails; the AI brief can't mention facts outside the sheet.
- **Trade-off:** the fallback is plainer.

### D10. Closing rules enforced in services
- Items can't close without an outcome (422); sessions can't close with open items (409).
- **Why:** the brief asks to record each item's outcome and follow items until closed; the rules make that impossible to skip.

### D11. pino + AsyncLocalStorage for request IDs
- **Why:** structured JSON, fast, built-in redaction; ALS stamps the request id on every line (including AI and service logs) without passing a logger around.
- **Rejected:** winston (slower, more config); passing `req.log` through every function.

### D12. One deployable (Express serves the React build)
- **Why:** one URL, no CORS, one free service.
- **Rejected:** Vercel + Render split (two deploys, CORS and cookie issues).

### D13. Embedded Postgres for local dev and tests
- **Why:** Docker wasn't available; `embedded-postgres` runs a real Postgres from npm, so tests use the same engine as production.
- **Rejected:** SQLite locally (different SQL and Prisma behaviour from production); mocking Prisma (tests would prove little).

### D14. Render in Ohio, next to Neon (us-east-2); direct (non-pooled) Neon URL
- **Why:** the app makes several DB queries per request; putting app and DB in the same AWS region keeps each one ~1 ms instead of ~200 ms across continents. Prisma migrations need a direct connection, and the free tier's traffic doesn't need PgBouncer pooling.
- **Rejected:** Singapore (closer to Mumbai users, but every query would cross the Pacific to the database).
- **Trade-off:** users in India see ~250 ms extra on the page request itself; still far better than paying it on every query.
