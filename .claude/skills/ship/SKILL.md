---
name: ship
description: Finish a task – verify, update spec and docs, write the commit. Use when implementation is complete.
---
1. Run build and test; fix failures before continuing.
2. In the active spec, tick met acceptance criteria; note deviations under "Changes during implementation" and update **Last updated**.
   Keep **Status** `Active` until the PR is merged (step 5).
3. Update the feature README / ADR ([document-feature skill](../document-feature/SKILL.md)) if behaviour changed.
   Removing a feature means deleting its folder, flags, DI registrations, tests and `docs/features.md` row in the same PR.
4. Stage only related files. Commit message ([Conventional Commits](https://www.conventionalcommits.org/)):
```
   <type>(<feature>): <imperative summary, ≤72 chars>
   
   <Spec: <spec-id>, optional>

   <Description. Why, not what. Use agentic run summary>
```
   - `<type>`: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `revert`.
   - `<feature>`: the feature folder name in kebab-case (`Orders` → `orders`); for cross-cutting changes use the area instead (`workflow`, `build`, `deps`).
   - `Spec:` line whenever an active spec drove the change.

5. Create the PR and link to the spec. Inform the user about the PR and ask for review. If the PR is merged, set **Status** to `Done` in the spec.
