## What and why

<!-- What does this change do, and why is it needed? Link the issue if there is one. -->

## How it was tested

<!-- Commands run, screenshots for UI changes, manual steps. -->

## Checklist

- [ ] `npm run typecheck` and `npm test` pass in `server/`
- [ ] `npm run build` passes in `web/`
- [ ] New behaviour has a test (AI behaviour uses the fake provider)
- [ ] Reads use the access filters from `server/src/access.ts`; anything the AI reads is visible to its audience
- [ ] No secrets, tokens or request bodies in code or logs
- [ ] README / `docs/DECISIONS.md` updated if behaviour, setup or a design choice changed
