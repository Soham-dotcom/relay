# Contributing to Relay

Thanks for helping. This guide covers how to set up, how the code is organised, and what a change must pass before it is merged.

## Setup

Requirements: Node.js 22 (see `.nvmrc`). No Docker or Postgres install is needed.

```bash
npm run install:all            # install server and web dependencies
cd server
cp .env.example .env           # add a GEMINI_API_KEY to enable AI (optional)
npm run db:local               # terminal 1: local Postgres on port 5433
npx prisma migrate deploy      # terminal 2: create tables
npm run db:seed                # demo data
npm run dev                    # API on :4000
npm run dev --prefix ../web    # UI on :5173
```

## Workflow

1. Create a branch from `main`: `feat/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
2. Keep each pull request to one change, small enough to review in one sitting.
3. Write commit messages in [Conventional Commits](https://www.conventionalcommits.org/) style: `feat(server): …`, `fix(web): …`, `docs: …`, `test: …`, `chore: …`. The body says **why**, not just what.
4. Open a pull request and fill in the template. CI must be green before merge.

## Where code goes

| Change | Place |
|---|---|
| New endpoint or input validation | `server/src/routes.ts` (zod schema, auth guard, call a service) |
| Business rule, transaction, history event | `server/src/services/*` |
| Who can see what | `server/src/access.ts` only. Never filter visibility in a page or a service by hand |
| Prompt or AI output shape | `server/src/ai/prompts.ts` (prompt and its zod schema side by side) |
| Database change | `server/prisma/schema.prisma`, then `npx prisma migrate dev --name <change>` and commit the migration |
| UI page / shared component | `web/src/pages/*` / `web/src/ui.tsx` |

## Rules that keep the project trustworthy

- **Validate every input** with zod at the route. Errors use the single `{ error: { code, message, details?, requestId } }` shape.
- **Every read query applies the access filter** (`sessionWhere`, `docWhere`, `itemWhere`), and every by-id route uses a guard. Hidden records return 404, not 403.
- **AI output is untrusted.** Validate it with a schema, accept only ids that were sent to the model, and give the user a non-AI path when the model fails.
- **Anything the AI reads must be visible to everyone who will see the result.**
- **Log events, not data.** Use the `event` field for key actions; never log request bodies, tokens, keys or connection strings.
- **Tests come with the change.** Behaviour changes need an API test in `server/test/`; AI behaviour is tested with the fake provider in `test/fakes.ts`, never the real API.

## Checks (CI runs the same)

```bash
cd server
npm run typecheck
npm test                       # needs `npm run db:local` running
cd ../web
npm run build
```

## Docs

Update `README.md` when behaviour, setup or the API changes, and add an entry to `docs/DECISIONS.md` for any design choice (what, why, alternatives rejected, trade-off).
