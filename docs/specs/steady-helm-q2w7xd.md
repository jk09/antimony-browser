# Feature Specification: The assistant switches and closes stacks

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `switch_stack` and `close_stack` tools for the assistant |
| **Spec ID** | steady-helm-q2w7xd |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-10 20:30 +00:00 |
| **Last updated** | 2026-10-10 20:50 +00:00 |
| **Affected features** | agent, stacks |
| **Target release** | 0.1.0 |
| **Related links** | spec open-roster-v5n9qk (`list_stacks`, its follow-up); PR #71 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The assistant can list stacks (`list_stacks`) and open new ones, but "go to my Spotify stack" or "close the Hacker News stacks" can't be done: there is no tool to switch or close a stack.
- **Desired outcome:** Two tools: `switch_stack` makes a named stack current; `close_stack` closes one after the user approves.

## 3. Background and Context

- **Current behavior:** `StackPort` (stacks → agent, `provideStacks`) has `open()` and `list()`. The UI switches (`stacks:switch`) and closes (`stacks:close`) by id; main's `switchTo` and `closeAndSwitch` do the work.
- **Motivation:** Natural follow-ups to listing stacks; stacks are the browser's tabs.
- **Related issues or references:** `agent/main/tools.ts`, `agent/main/agent.ts` (approval rules), `stacks/main.ts`.

## 4. Goals

- The model can switch to any open stack by name and then work on its page.
- The model can close a stack, never without the user's approval.

## 5. Non-Goals

- Closing single pages, renaming or reordering stacks.
- Switching or closing by anything but the stack name (`@name`); unnamed stacks ("New tab") can't be targeted.

## 6. User Stories

- As a user, I want to say "switch to @spotify-web-player" or "go to the stack with the Tempest page" and have the assistant do it.
- As a user, I want "close all the search stacks" to show me each close (or the first, with Allow for this run) before anything is lost.

## 7. Functional Requirements

1. **Port**: `StackPort` gains `switch(name): boolean` and `close(name): boolean` (false: no open stack has that name). Stacks implements them with `switchTo` and `closeAndSwitch` (closing the current stack switches to the most recently used one, or opens one at the home page if it was the last).
2. **Tool kind `stack`**: no page access, no history access needed; doesn't read page content.
3. **`switch_stack`** `{ stack }` (`@name` or `name`): no approval, replayable (macros may contain it). Result: `Switched to @name.` plus the page state (URL, untrusted title). Unknown name → error naming `list_stacks`. Switching to the current stack does nothing and says so.
4. **`close_stack`** `{ stack }`: asks for approval (`Close stack @name`); "Allow for this run" covers later closes in the run; not replayable (no macro can contain it). Result: `Closed @name.` and the number of stacks left. Unknown name → error.
5. **System prompt**: the stacks line mentions `switch_stack` and `close_stack` (close only when the user asked).
6. Both work while page access and history access are off.

## 8. Non-Functional Requirements

- Performance: trivial.
- Reliability: a stack closed by name that's already gone → the error result, nothing else closes.
- Security: no new IPC. A switch carries no model-chosen URL, so it needs no approval even after page content was read; closing loses the stack's tree, so it is approved like a page action. Recorded in the agent README's security surface.
- Privacy: nothing new stored or sent.
- Accessibility: approval row and conversation lines as for other tools.
- Platforms: all.

## 9. UX / UI Notes

- User flow: "close the bing search stacks" → model calls `list_stacks`, then `close_stack` per match → approval row "Close stack @bing-search" → Allow for this run → the rest close.
- Edge cases: closing the last stack (a new one opens at the home page, or an empty one without a home page); switching while the header's switcher is disabled (the assistant runs) still works – the switcher is disabled only for the user.

## 10. Technical Notes

- Proposed approach: `tools.ts` – kind `stack`, two definitions, `describeCall`, `executeTool` branches; `agent.ts` – approval for `close_stack` (with `allowAll`), `stack` tools take the browser if there is one; `stacks/main.ts` – `switch`/`close` on the port.
- Process split: main only.
- Dependencies: unchanged (agent ↔ stacks via `provideStacks`).
- Risks / unknowns: none.
- Open questions: none.

## 11. Acceptance Criteria

- [x] `switch_stack` switches by name without approval, reports the page, errors on unknown names, is replayable – `agent/main/tools.test.ts`, `agent/main/agent.test.ts`.
- [x] `close_stack` waits for approval (Deny keeps the stack), Allow for this run covers the next close, isn't replayable – `agent/main/agent.test.ts`, `agent/main/tools.test.ts`.
- [x] Both are offered without page or history access – `tools.test.ts › toolsFor`.
- [x] Stacks' port switches and closes by name (closing the current one switches to the most recent) – `stacks/main.test.ts`.
- [x] `npm run check` passes; e2e passes.

## 12. Testing / Verification

- Manual test plan: with a few stacks, ask to switch to one, then to close two of them.
- Automated test coverage: unit tests above.
- Regression considerations: `new_stack`, `list_stacks`, macros validation (`checkStep` rejects `close_stack`).

## 13. Rollout / Follow-up

- Rollout plan: no flag.
- Follow-up work: closing single pages of a stack.

## 14. Changes during implementation

- `switch_stack` was added to the replayable tools named in `save_macro`'s description and the system prompt's macro rules. A macro argument typed as `@stack` becomes that page's URL, so a parameter meant for `switch_stack` takes the bare name.
- `StackPort.switch` and `close` return whether a stack had that name; the tools check the name against `list()` first so they can say "already current" and report the stacks left.
