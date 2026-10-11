# Feature Specification: A stack order the assistant can change

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Stacks keep an order of their own (shown in the switcher and `list_stacks`); the assistant's `move_stack` tool changes it |
| **Spec ID** | settled-row-h4n6tp |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-11 09:00 +00:00 |
| **Last updated** | 2026-10-11 09:40 +00:00 |
| **Affected features** | stacks, agent |
| **Target release** | 0.1.0 |
| **Related links** | specs open-roster-v5n9qk, steady-helm-q2w7xd, brief-pruner-z8k3mf (the other stack tools); PRs #71–#73 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Stacks are always listed most recently used first, so they reshuffle on every switch and can't be arranged ("put my work stacks at the top").
- **Desired outcome:** Stacks have a stored order. The switcher and `list_stacks` show it; `move_stack { stack, position }` changes it. Ctrl+Tab and everything else that means "most recent" keep using recency.

## 3. Background and Context

- **Current behavior:** `stacks/main.ts` sorts by `lastUsedAt` for the switcher (`state().stacks`), `pages()`, the port's `list()`, eviction at 50 stacks and the stack shown after closing the current one. The UI's Ctrl+Tab cycle takes `state().stacks` as its most-recent order.
- **Decision (user):** a pinned order rather than pin-to-top or a recency bump.

## 4. Goals

- A persistent order, unchanged by switching.
- The assistant can move a stack to a position.
- Ctrl+Tab, eviction and "next stack after closing the current one" stay most recently used.

## 5. Non-Goals

- Drag-and-drop reordering in the switcher (follow-up).
- Changing the `@` suggestions' order (stays most recently used).

## 6. User Stories

- As a user, I want "move @work to the top" and "put the Spotify stack last" to stick, so the switcher reads the way I arranged it.

## 7. Functional Requirements

1. **Order**: the order of `stacks.json`'s `stacks` array (`version: 3`). Loading a version 1–2 file orders it most recently used first, once. A new stack (link, Ctrl/Cmd+N, the assistant, the first typed URL) goes on top; imported stacks go to the bottom (unopened, behind the user's).
2. **State**: `StacksState.stacks` is in that order; new `StacksState.recent` lists the stack ids most recently used first. The switcher list shows the order; Ctrl+Tab cycles `recent`.
3. **Port**: `StackPort.move(name, position): boolean` (position 1 = top; past the end = last; false: no such stack). `list()` follows the order.
4. **Tool `move_stack`** `{ stack, position }` (kind `stack`): no approval (nothing is lost; it's undone by moving back), replayable, no page or history access. `position` is an integer ≥ 1. Result: `Moved @name to position P of N.` Unknown name → error.
5. `list_stacks` says `in the user's order` instead of `most recently used first`; the system prompt names `move_stack`.

## 8. Non-Functional Requirements

- Reliability: version 1–2 `stacks.json` files load (ordered by recency once); a version 3 file is not meant for older builds.
- Security: no new IPC; the tool only reorders.
- Privacy: nothing new stored beyond the order.
- Platforms: all.

## 9. UX / UI Notes

- The switcher list is in the stored order; the current stack is highlighted wherever it is.
- Edge cases: position 0 or negative → validation error; position beyond the count → last; moving to the current position → says so and changes nothing.

## 10. Technical Notes

- `stacks/main.ts`: the `stacks` `Map` keeps the order (rebuilt when a stack moves or is added on top); `byRecentUse` stays for recency. `shared/stored.ts`: version 3, migration sort. `ipc.ts`: `recent`. UI: cycle over `recent`. Agent `tools.ts`: tool, `describeCall`, `executeTool`.
- Risks: anything else that assumed `state().stacks` is most recent first – only the Ctrl+Tab cycle (checked).

## 11. Acceptance Criteria

- [x] Version 1–2 files load most recently used first; version 3 keeps the stored order; switching doesn't change it; new stacks go on top, imported ones to the bottom – `stacks/shared/stored.test.ts`, `stacks/main.test.ts`.
- [x] `state().recent` is most recently used first and Ctrl+Tab cycles it – `stacks/main.test.ts`, `stacks/ui/StackHeader.test.tsx`.
- [x] The port moves a stack and the order persists – `stacks/main.test.ts`.
- [x] `move_stack` moves without approval, validates the position, errors on unknown names, is replayable – `agent/main/tools.test.ts`, `agent/main/agent.test.ts`.
- [x] `npm run check` and e2e pass.

## 12. Testing / Verification

- Manual test plan: switch between stacks (list order stays), ask the assistant to move one to the top, restart (order kept), Ctrl+Tab (recency).
- Automated test coverage: unit tests above; existing e2e stacks tests.

## 13. Rollout / Follow-up

- Rollout plan: no flag; `stacks.json` becomes version 3 on the first save.
- Follow-up work: drag-and-drop in the switcher.

## 14. Changes during implementation

- The order lives in the stacks `Map`'s insertion order (rebuilt when a stack moves or is added on top), which is also the order `stacks.json` saves.
- `stacks/main.test.ts › starts a new stack…` asserted the stack shown after closing the current one by name; with the test's frozen clock that name only won a tie in last-used times. It now asserts the rule (the most recently used one left).
- `move_stack` is replayable, so it was added to the replayable tools named in the system prompt and `save_macro`'s description; moving to the current position reports it and changes nothing.
