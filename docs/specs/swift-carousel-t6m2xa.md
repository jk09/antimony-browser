# Feature Specification: Switch stacks with Ctrl+Tab

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Ctrl+Tab / Ctrl+Shift+Tab switch between stacks, most recently used first, while Ctrl is held |
| **Spec ID** | swift-carousel-t6m2xa |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-02 08:00 +00:00 |
| **Last updated** | 2026-10-02 09:30 +00:00 |
| **Affected features** | stacks, prompt |
| **Target release** | 0.1.0 |
| **Related links** | [branching-trail-k4w9zp](./branching-trail-k4w9zp.md) (stacks), [nimble-anchor-w3p8kd](./nimble-anchor-w3p8kd.md) (stack shortcuts) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Switching stacks needs the mouse (`@name ▾` list) or typing `@name` in the prompt; there's no keyboard shortcut like the browser-standard Ctrl+Tab.
- **Desired outcome:** Ctrl+Tab switches to the previously used stack; holding Ctrl and pressing Tab again walks through older stacks in the open stack list, and releasing Ctrl switches to the highlighted one. Ctrl+Shift+Tab walks the other way.

## 3. Background and Context

- **Current behavior:** The stack list (`@name ▾`) is sorted most recently used first; switching makes a stack the most recent. Ctrl/Cmd+R, N and W are caught in `before-input-event` and sent to the UI as `stacks:command` (spec nimble-anchor-w3p8kd).
- **Motivation:** Fast toggling between two stacks and keyboard-only access to any stack, as in Alt+Tab, VS Code or Firefox.
- **Related issues or references:** –

## 4. Goals

- Goal 1: A single Ctrl+Tab toggles between the two most recently used stacks.
- Goal 2: Holding Ctrl reaches any stack, with visible feedback of the target.

## 5. Non-Goals

- Non-goal 1: Switching to the n-th stack (Ctrl+1…9).
- Non-goal 2: A different stack order in the `@name ▾` list.

## 6. User Stories

- As a user, I want Ctrl+Tab to take me back to the stack I was just in, and Ctrl+Tab again to return.
- As a user, I want to hold Ctrl and tap Tab to pick an older stack without the mouse.

## 7. Functional Requirements

1. **Start.** Ctrl+Tab (Ctrl+Shift+Tab) with two or more stacks takes a snapshot of the stacks in most-recently-used order (the current one first), opens the stack list and highlights the second (the last) one.
2. **Step.** While Ctrl stays held, each further Tab (Shift+Tab) moves the highlight one down (up), wrapping around.
3. **Commit.** Releasing Ctrl closes the list and switches to the highlighted stack (nothing happens if it is the current one).
4. **Cancel.** Escape while cycling, or the window losing focus, closes the list without switching.
5. The keys work whether the page or the chrome UI has focus, and the page doesn't receive them; Ctrl is used on every platform (macOS too, as in Safari and Chrome).
6. While the assistant runs, the keys do nothing (switching is disabled then), and with fewer than two stacks too.
7. File menu items "Next Stack" (Ctrl+Tab) and "Previous Stack" (Ctrl+Shift+Tab) switch immediately one step, so `/menu` reaches them.
8. The switcher button's hint becomes "Switch stack (Ctrl+Tab)".

## 8. Non-Functional Requirements

- Performance: One IPC event per key press.
- Reliability: A stack closed during cycling is skipped on commit (the switch IPC is validated anyway).
- Security: No new IPC channel: `stacks:command` gains `cycle-next`, `cycle-previous`, `cycle-end`, `cycle-cancel` (main → UI). `before-input-event` consumes Ctrl+Tab, Ctrl+Shift+Tab, and Escape / Ctrl key-up only while cycling.
- Privacy: –
- Accessibility: The highlighted stack is marked `aria-selected` in the list; the switcher has `aria-keyshortcuts="Control+Tab"`.
- Platforms: Ctrl on all platforms.

## 9. UX / UI Notes

- User flow: Ctrl down → Tab (list opens, previous stack highlighted) → Tab … → Ctrl up (switch).
- Visual considerations: The existing stack list, with the target row highlighted like a focused row.
- Edge cases: One stack – nothing; the list already open by click – cycling takes it over; a stack closes mid-cycle – the snapshot drops it.

## 10. Technical Notes

- Proposed approach: `shared/keys.ts` gains `cycleKeyFor(input)` (`next` / `previous` on Ctrl+[Shift+]Tab key-down, `release` on Control key-up, `escape`). Main sends `cycle-*` commands, tracks only whether a cycle is open (to consume Escape / Control-up and cancel on window blur). The UI keeps the snapshot and index, and switches with `stacks.switch` on `cycle-end`.
- Process split: main – key capture, menu items; UI – snapshot, highlight, switch.
- Dependencies: none new.
- Risks / unknowns: A Control key-up lost to another window (focus moved while held) – covered by cancel on blur.
- Open questions: –

## 11. Acceptance Criteria

- [x] Ctrl+Tab then releasing Ctrl switches to the previously used stack; doing it again switches back.
- [x] Holding Ctrl and pressing Tab n times highlights the n-th most recent stack in the open list; releasing switches to it; Ctrl+Shift+Tab moves backwards; both wrap.
- [x] Escape or window blur while cycling cancels without switching.
- [x] Works with focus in the page and in the chrome UI.
- [x] Nothing happens while the assistant runs or with fewer than two stacks.
- [x] File › Next Stack / Previous Stack switch one step.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: Open three stacks (new-tab links or Ctrl+N), cycle with focus in the page and in the prompt, cancel with Escape.
- Automated test coverage: unit – `shared/keys.test.ts` (`cycleKeyFor`), `main.test.ts` (commands sent, Escape and key-up only consumed while cycling, blur cancels, menu items), `ui/StackHeader.test.tsx` (snapshot, highlight, wrap, commit, cancel, assistant running); e2e – `e2e/stacks.spec.ts` Ctrl+Tab toggles two stacks.
- Regression considerations: Ctrl/Cmd+R, N, W; Tab in the prompt (suggestion completion uses Tab without Ctrl).

## 13. Rollout / Follow-up

- Rollout plan: Ships enabled, no flag.
- Follow-up work: Ctrl+1…9.

## 14. Changes during implementation

- Ctrl+Tab isn't consumed in `before-input-event` (the spec said the page doesn't receive it): after a consumed key-down Chromium drops every key event up to the next key-down, so the Ctrl key-up that ends the cycle never arrived (found by the e2e test). Pages get the Ctrl+Tab key events but don't act on them; the prompt no longer completes a suggestion on Ctrl+Tab.
- The Ctrl key-up isn't consumed either (pages keep their modifier state); only Escape is, while cycling.
- The File menu items show Ctrl+[Shift+]Tab with `registerAccelerator: false`: registered, the unconsumed key would also run their one-step click.
- Affected features: prompt too (the Tab completion guard).
- The highlighted stack is marked with `aria-selected` on its list item and the `target` class (outline).
