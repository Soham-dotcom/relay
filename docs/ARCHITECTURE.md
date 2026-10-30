# Architecture

## Components

```
Browser (React + Vite + Tailwind, TanStack Query)
   │  fetch /api/*            (same origin in production)
   ▼
Express app  ── request-id middleware (AsyncLocalStorage) ── pino-http access log
   │
   ├─ routes.ts          HTTP + zod validation, nothing else
   ├─ services/
   │   ├─ sessions.ts    meetings & transfers, attendance, transfer-items
   │   ├─ items.ts       item lifecycle, history events, carry forward
   │   ├─ recap.ts       AI draft → user review → apply (+ follow-ups)
   │   ├─ brief.ts       fact sheet → AI brief, or data-only fallback
   │   ├─ knowledge.ts   docs, session indexing, retrieve-then-AI linking
   │   └─ conflicts.ts   retrieve-then-AI decision conflict check
   ├─ ai/
   │   ├─ provider.ts    AiProvider interface + Gemini implementation
   │   ├─ client.ts      timeout, JSON extraction, zod validation, 1 retry, logging
   │   └─ prompts.ts     system prompts + zod schemas side by side
   └─ errors.ts          AppError + single error handler
   │
   ▼
PostgreSQL (Prisma)                     Gemini API (text + embeddings)
```

## Data flow: saving a recap

1. `POST /sessions/:id/recap/draft {raw}` → `recap.draftRecap` → Gemini (recap prompt) → zod check (retry once) → owner names matched to participants → **draft returned, nothing saved**.
2. User edits the draft in the UI.
3. `POST /sessions/:id/recap/apply` → one transaction: session summary + status HELD, decisions, items (+ `CREATED` events).
4. In parallel, best-effort: `linkToKnowledge` (embed targets → rank docs → AI picks links with reasons) and `checkConflicts` (embed decisions → top-5 earlier decisions → AI judges contradictions).
5. `indexSession` stores the session as a knowledge doc for future linking.
6. Response lists counts + warnings for any step that degraded.

## Data flow: catch-up brief

`buildBriefContext` gathers the session, participants, decisions with open conflicts, items (plus all open items of the reader and, for a transfer, of the leaver), overdue and carried-forward counts. That JSON is the **only** input to the model. If AI fails, `fallbackBrief` renders the same JSON deterministically.

## Data model

Session ─< Participant >─ Person
Session ─< Decision ─< DecisionConflict >─ Decision (earlier)
Session ─< ActionItem (current) / ActionItem.originSession
ActionItem ─< ItemEvent (append-only history)
KnowledgeDoc ─< KnowledgeLink >─ ActionItem | Decision
Session ─1 KnowledgeDoc (source = MEETING)
Session.previousId → Session (chain of follow-ups)

## Deployment

One Render web service: build web → build server; `npm start` runs `prisma migrate deploy` then Node. Express serves `web/dist` and falls back to `index.html` for client routes. Postgres on Neon. CI on GitHub Actions runs typecheck, tests (Postgres service container) and the web build.
