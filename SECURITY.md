# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Email **sohambudhewar@gmail.com** with the steps to reproduce and the impact. You will get a reply within 3 working days.

## How Relay protects data

- **Access control on the server.** Every API route except health and sign-in needs a signed JWT. Every query is filtered by what the signed-in user may see (`server/src/access.ts`); hidden records return 404 and log `access.denied`.
- **The AI only sees what its audience may see.** Briefs, knowledge links and conflict checks are built from records visible to everyone who will read the result.
- **Input validation** on every request (zod), JSON bodies capped at 256 KB.
- **Secrets** come only from environment variables, are never committed (`.env*` is git-ignored) and are redacted from logs. Request bodies are never logged.
- **`JWT_SECRET` is required in production**; the server refuses to start without it.

## Known limitation

The live demo uses a **sign-in picker**: anyone can sign in as any demo person. That is intentional, so evaluators can switch users. A real deployment must put SSO or another identity provider in front of `POST /api/auth/login`.
