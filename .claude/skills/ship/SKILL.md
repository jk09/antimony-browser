---
name: ship
description: Finish a task – verify, update spec and docs, write the commit. Use when implementation is complete.
---
1. Run `npm run check` (lint, format, typecheck, unit tests). If main-process, preload or UI behaviour changed, also run `npm run test:e2e` (`xvfb-run -a npm run test:e2e` on Linux without a display; if the Electron binary isn't installed, e.g. in a cloud session, say so and rely on CI). Fix failures before continuing.
2. In the active spec, tick met acceptance criteria; note deviations under "Changes during implementation" and update **Last updated**.
   Keep **Status** `Active` until the PR is merged (step 5).
3. Update the feature README / ADR ([document-feature skill](../document-feature/SKILL.md)) if behaviour changed.
   Removing a feature means deleting its folder, flags, registrations (`src/app/main/features.ts`, `src/app/preload/index.ts`, `src/shared/api.ts`, `src/app/renderer/`), tests and `docs/features.md` row in the same PR.
4. Stage only related files. Commit message ([Conventional Commits](https://www.conventionalcommits.org/)):
```
   <type>(<feature>): <imperative summary, ≤72 chars>
   
   <Spec: <spec-id>, optional>

   <Description. Why, not what. Use agentic run summary>
```
   - `<type>`: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `revert`.
   - `<feature>`: the feature folder name (`src/features/navigation` → `navigation`); for cross-cutting changes use the area instead (`app`, `workflow`, `build`, `deps`, `security`).
   - `Spec:` line whenever an active spec drove the change.

5. Create the PR and link to the spec. Inform the user about the PR and ask for review. If the PR is merged, set **Status** to `Done` in the spec.
6. Always watch the PR you opened (in cloud sessions: subscribe to its activity) until it's merged or closed: fix CI failures and address review comments without being asked, validating each fix with step 1 before pushing.
