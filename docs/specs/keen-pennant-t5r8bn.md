# Feature Specification: Ctrl/Cmd+T adds a page to the current stack

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Ctrl/Cmd+T adds a new page at the home page to the current stack (or fills / opens a stack when there is none to add to) |
| **Spec ID** | keen-pennant-t5r8bn |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-24 10:09 +00:00 |
| **Last updated** | 2026-10-24 10:30 +00:00 |
| **Affected features** | stacks |
| **Target release** | 0.1.0 |
| **Related links** | specs branching-trail-k4w9zp, swift-carousel-t6m2xa (new stack, home page), ADR 0008 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Ctrl/Cmd+T is the universal "new tab" key, but Antimony does nothing with it. Ctrl/Cmd+N starts a whole new stack; there is no key to add another page to the stack you are working in.
- **Desired outcome:** Ctrl/Cmd+T opens the home page as a new page (branch) of the current stack. When the current stack is empty it fills that stack, as New stack does.

## 3. Background and Context

- **Current behavior:** A stack is one live tab plus a tree of the pages it visited. Ctrl/Cmd+N (File → New Stack, the + button) starts a new stack at the home page, or fills the current stack if it is empty. Ctrl/Cmd+T is unbound.
- **Motivation:** A new page in the current stack keeps related work together, and matches the muscle memory of Ctrl/Cmd+T.
- **Related issues or references:** the stacks README (shortcuts, spare tab, tree rules).

## 4. Goals

- Ctrl/Cmd+T navigates the current stack's tab to the home page as a new branch (a child of the active page), focuses the page, and works whether the chrome UI or a page has focus.
- With an empty current stack (or no stack) Ctrl/Cmd+T behaves like New stack.
- A File menu item "New Page" shows the shortcut.

## 5. Non-Goals

- A stack owning several live tabs; the stack model, `stacks.json` and navigation are unchanged.
- Changing Ctrl/Cmd+N, the spare tab or the home page setting.
- A new IPC channel or assistant tool.

## 6. User Stories

- As a user, I want Ctrl+T to open a fresh page next to what I am reading so that I can branch off without starting a separate stack.
- As a user with a brand-new empty stack, I want Ctrl+T to just give me the home page so that it never leaves me with two empty stacks.

## 7. Functional Requirements

1. Ctrl+T (Cmd+T on macOS), without Alt or Shift, is caught like Ctrl/Cmd+R, N, W, E (page or chrome UI focused, before the page sees it) and sends the command `new-page` to the UI.
2. File → New Page (accelerator `CmdOrCtrl+T`) sends the same command.
3. The UI runs `new-page`:
   - the assistant is running → nothing (like New stack);
   - the current stack has a page (its tree is not empty) and a home page is set → the tab loads the home page through `navigation.go`, so it becomes a new child of the active page (a branch, per the tree rules) and the page gets focus; the stack list is closed;
   - the current stack has no page, or there is no current stack → same as `stacks.create` (New stack);
   - there is no home page and the stack has a page → nothing is added (the key already moved focus to the chrome UI).
4. If the active page already is the home page, no node is added (the tree never duplicates a page); the page keeps focus.
5. Ctrl/Cmd+N and its behavior are unchanged.

## 8. Non-Functional Requirements

- Performance: no extra work; loads one URL in the existing tab.
- Reliability: none beyond New stack's.
- Security: no new IPC channel, argument or capability; the shortcut is caught in main like the others. Web content cannot trigger it (the key is consumed in `before-input-event`).
- Privacy: nothing new stored; the home page is fetched as with any navigation to it.
- Accessibility: the File menu item and the button hints name the shortcut.
- Platforms: Ctrl on Windows/Linux, Cmd on macOS (same rule as the other shortcuts).

## 9. UX / UI Notes

- User flow: read a page → Ctrl+T → the home page appears as a branch below it in the tree, focused → type or follow a link; click the parent in the tree to go back.
- Visual considerations: none; the tree shows the new branch like any other.
- Edge cases: the active page is the home page (no node added); no home page (nothing is added); the assistant runs; the current stack is unopened (imported): New stack's behavior applies only when it has no page, otherwise its tab exists once switched to.

## 10. Technical Notes

- Proposed approach: add `t: 'new-page'` to `KEYS` in `shared/keys.ts` and `'new-page'` to `StackCommand` in `ipc.ts`; add the File menu item in `main.ts`; in `StackHeader.tsx` add `newPage` beside `newStack`, register it in the `commands` ref and dispatch it in `onCommand`. It reads the home page via the existing `stacks:home` channel and navigates via the existing `navigation:go`.
- Process split: main catches the key and menu item → `stacks:command` (existing channel) → UI → existing `navigation:go` / `stacks:create` / `stacks:home`.
- Dependencies: navigation (`go`).
- Risks / unknowns: `shortcutLabel` finds a key by its command, so the new key is added without breaking `n`; Ctrl+T must not be taken by the page first (hence `before-input-event`).
- Open questions: none.

## 11. Acceptance Criteria

- [x] `stackCommandFor` maps Ctrl+T (Cmd+T on macOS) to `new-page`, and ignores it with Alt, Shift, key repeat or the wrong modifier.
- [x] Ctrl+T in the chrome UI or a page sends `new-page` and is consumed; File → New Page shows `Ctrl+T` / `Cmd+T` and sends the same command.
- [x] With a page in the current stack and a home page, the UI loads the home page, which becomes a child of the active page; `stacks.create` is not called.
- [x] With an empty or missing current stack, it calls `stacks.create`.
- [x] While the assistant runs nothing happens.
- [x] On the home page already, the tree gets no duplicate node.
- [x] Ctrl+N still starts a new stack.
- [x] `npm run check` passes and the stacks README and `docs/features.md` are updated.

## 12. Testing / Verification

- Manual test plan: open a page, press Ctrl+T, see the home page as a child in the tree, then click the parent; in an empty stack press Ctrl+T and see one stack only.
- Automated test coverage: `shared/keys.test.ts` (mapping); `main.test.ts` (key and menu item send `new-page`); `ui/StackHeader.test.tsx` (the three cases and the assistant-running case); `e2e/stacks.spec.ts` (Ctrl+T adds a branch).
- Regression considerations: `shortcutLabel('new')` still reads `Ctrl+N`; Ctrl+Tab cycling is unaffected.

## 13. Rollout / Follow-up

- Rollout plan: ships with the next release; no flag.
- Follow-up work: none planned.

## 14. Changes during implementation

- No home page and a stack with a page: nothing is added instead of focusing the prompt (the UI has no way to focus it; the key press already focuses the chrome UI).
