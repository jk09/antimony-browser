# Feature Specification: The assistant closes single pages

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `close_page` tool: the assistant closes one page of a stack with its branch |
| **Spec ID** | brief-pruner-z8k3mf |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-11 08:10 +00:00 |
| **Last updated** | 2026-10-11 08:50 +00:00 |
| **Affected features** | agent, stacks |
| **Target release** | 0.1.0 |
| **Related links** | PR #73; specs steady-helm-q2w7xd (`switch_stack`, `close_stack`; this is its follow-up), open-roster-v5n9qk (`list_stacks`, page refs); PRs #71, #72 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The assistant can close whole stacks but not a page in one ("close the FAQ page in @docs", "close the search results pages").
- **Desired outcome:** `close_page { page: "@stack/ref" }` does what the page's × in the tree does, in any stack, after the user approves.

## 3. Background and Context

- **Current behavior:** The UI closes a node of the current stack (`stacks:close-node` → `removeBranch`; the root closes the stack; a removed active page loads its parent). `list_stacks` shows each page's `@stack/ref`.
- **Motivation:** Completes the stack tools; stacks grow long and the user wants to prune them by asking.

## 4. Goals

- Close one page and the pages opened from it (its branch), by `@stack/ref`, in any stack.
- Never without the user's approval, and the approval says what else closes.

## 5. Non-Goals

- Keeping the branch (re-parenting children); closing by URL or title.

## 6. User Stories

- As a user, I want "close the manual in my docs stack" to show "Close @docs/manual and 2 pages below it" before anything goes.

## 7. Functional Requirements

1. **Port**: `StackPort.closePage(name, ref): boolean` (false: no such stack or page). The root closes the stack like `close_stack`; otherwise `removeBranch`; when the removed branch held the stack's active page and the stack has a live tab, its parent loads there (a stack without a tab just moves its active page; the current stack stays current).
2. **`close_page`** `{ page }` (kind `stack`, not replayable): approval row from the tool's own reading of `list()`: `Close @s/ref`, `Close @s/ref and N pages below it`, or `Close @s/ref, the first page: the whole stack @s`; "Allow for this run" covers later closes. Result `Closed @s/ref[ and N pages below it].` or `Closed @s/ref, the first page, with the whole stack.`. Unknown page → error naming `list_stacks`.
3. Works without page and history access. System prompt names it with the other stack tools.

## 8. Non-Functional Requirements

- Security: no new IPC; approved like `close_stack`; refs come from `list()` (no URL from the model is loaded).
- Privacy: nothing new stored or sent.
- Platforms: all.

## 9. UX / UI Notes

- Edge cases: closing the active page of the current stack (its parent loads, as with ×); of an unopened stack (no tab is created); the root (the stack closes and the most recent one becomes current if it was current).

## 10. Technical Notes

- `tools.ts`: `pageBranch`, `describeClosePage`, `closePage`; `agent.ts` uses `describeClosePage` for the approval row; `stacks/main.ts` implements `closePage`.
- Dependencies: unchanged.

## 11. Acceptance Criteria

- [x] `close_page` waits for approval with the branch size in the row and closes through the port; unknown pages fail without closing – `agent/main/agent.test.ts › closes a page only after approval…`, `agent/main/tools.test.ts › close_page`.
- [x] The root closes the stack; not replayable; offered without page or history access – `tools.test.ts › close_page`, `› toolsFor`.
- [x] Stacks close a page of any stack by ref; another live stack's tab loads the parent; the current stack stays – `stacks/main.test.ts › lets the assistant close a page of any stack by its ref`.
- [x] `npm run check` and e2e pass.

## 12. Testing / Verification

- Manual test plan: ask to close a page with children in another stack, then the first page of a stack.
- Automated test coverage: unit tests above.

## 13. Rollout / Follow-up

- Rollout plan: no flag.

## 14. Changes during implementation
