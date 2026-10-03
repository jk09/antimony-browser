# Feature Specification: Keyboard navigation of the stack tree (Ctrl+E, type-ahead)

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Ctrl+E focuses the navigation tree; arrow keys and type-ahead move through it |
| **Spec ID** | silent-orchid-x2m7pd |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-03 00:00 +00:00 |
| **Last updated** | 2026-10-03 15:10 +00:00 |
| **Affected features** | stacks |
| **Target release** | 0.1.0 |
| **Related links** | branching-trail-k4w9zp, swift-carousel-t6m2xa, fresh-anchor-w6p3jd |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The navigation tree in the panel header can be walked with ↑ ↓ Home End once a row has focus, but there is no shortcut to get focus there, and no way to jump to a page by name.
- **Desired outcome:** Ctrl+E (Cmd+E on macOS) moves focus into the tree, on the active page. ↑ ↓ Home End move between rows; typing letters jumps to the next row whose title starts with the typed text, as in a file manager, and a badge shows what has been typed so the user knows type-ahead is active.

## 3. Background and Context

- **Current behavior:** Rows are `role="treeitem"` with a roving tabindex (`StackHeader.tsx`); `moveFocus` handles ↑ ↓ Home End, Enter/Space opens, Delete closes. Focus gets there only by Tab or mouse. Ctrl/Cmd+R, N, W are caught in main and sent as `stacks:command`.
- **Motivation:** Keyboard-only use of the stack, and quick jumps in long branching trees.
- **Related issues or references:** stacks README, `shared/keys.ts`.

## 4. Goals

- Ctrl/Cmd+E works whether the page or the chrome UI has focus.
- Type-ahead selection in the tree with clear visual feedback.
- The full-stack overlay (`⋯ N more`) behaves the same way.

## 5. Non-Goals

- Navigating the list of stacks (the `@name ▾` switcher) by type-ahead.
- Type-ahead across stacks or into page content; fuzzy or substring matching.
- Changing what Enter, Space or Delete do.

## 6. User Stories

- As a keyboard user, I want Ctrl+E to put me in the navigation tree so that I need not reach for the mouse.
- As a user with a long tree, I want to type the start of a page's title so that focus jumps to it.
- As a user, I want to see that my typing is being used for navigation so that I do not think the keys are lost.

## 7. Functional Requirements

1. Ctrl+E (Cmd+E on macOS; no Alt/Shift) focuses the active row of the tree. Page or chrome UI focus; the key is consumed so the page does not see it. Pressing it again with focus already in the tree returns focus to the page.
2. If the tree is collapsed so that the active row is hidden, or the tree is empty (no rows), nothing is focused; with no rows the key does nothing.
3. While the assistant runs the tree stays navigable (focus moves are not state changes); opening a page still follows the existing rules.
4. With focus on a row: ↑ ↓ Home End move focus (existing). A printable character without Ctrl/Cmd/Alt appends to a type-ahead prefix and focuses the first row, searching from the row after the current one and wrapping, whose title (else URL) starts with the prefix, case-insensitively. Typing the same single letter repeatedly cycles through rows starting with it.
5. The prefix resets after 1 s without typing. Backspace removes the last character, Escape clears it (Escape with no prefix leaves the tree and focuses the page).
6. Visual feedback: while a prefix exists a badge in the tree shows it (`typing: li`) with the matched part of the row title highlighted. With no match the badge turns to an error colour and shakes briefly, focus stays. The badge announces itself to screen readers (`aria-live="polite"`).
7. Space is part of the prefix once a prefix exists; otherwise it keeps opening the row.
8. In the full-stack overlay the same keys work on its rows.
9. Menu: View/File entry "Focus Stack" with the accelerator, via `ctx.fileMenu`.

## 8. Non-Functional Requirements

- Performance: matching is linear in rows (max 500); no re-render of the tree beyond the badge.
- Reliability: timers cleared on unmount; stale prefix never survives focus leaving the tree.
- Security: one new `stacks:command` value (`focus-tree`), no new channel; argument validated as before. No web content access.
- Privacy: nothing stored.
- Accessibility: roving tabindex kept; badge is a polite live region; highlight not colour-only (bold + underline); respects `prefers-reduced-motion` (no shake).
- Platforms: Ctrl on Windows/Linux, Cmd on macOS (the stacks shortcuts pattern).

## 9. UX / UI Notes

- User flow: Ctrl+E → focus ring on the active row → type `ho` → badge `ho`, row "Home – …" gets focus with `ho` highlighted → Enter opens it.
- Visual considerations: badge pinned to the tree's top right, small, matching the header theme in light and dark.
- Edge cases: no match; prefix typed while the tree is collapsed (matches only visible rows plus `⋯`: it searches all rows and opens the overlay if the match is hidden — decision: open the overlay); IME composition ignored; key repeat of a held letter cycles.

## 10. Technical Notes

- Proposed approach: add `E` → `focus-tree` to `KEYS` in `shared/keys.ts` and `StackCommand` in `ipc.ts`; pure `typeAhead(rows, from, prefix)` in `shared/typeahead.ts`; a `useTypeAhead` hook and badge in `ui/StackHeader.tsx`; styles in `styles.css`.
- Process split: main catches the key (existing `before-input-event`), sends `stacks:command`; the UI focuses the row and owns the type-ahead state.
- Dependencies: none new.
- Risks / unknowns: collision with page shortcuts for Ctrl+E (search-bar focus in Chromium; accepted, same as R/N/W).
- Open questions: none.

## 11. Acceptance Criteria

- [x] Ctrl/Cmd+E from the page or chrome UI focuses the active row and the page does not receive the key.
- [x] Ctrl/Cmd+E in the tree returns focus to the page.
- [x] Typing letters focuses the first matching row after the current one, wrapping, case-insensitive.
- [x] A badge shows the typed prefix; no match marks it as an error; Backspace, Escape and the 1 s timeout behave as in 7.5.
- [x] Matched text is highlighted in the row.
- [x] Works in the overlay; a hidden match opens it.
- [x] Menu item shows the accelerator.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: build a branching stack, Ctrl+E, type prefixes, Backspace, Escape, wait out the timeout.
- Automated test coverage: unit tests for `keys.ts` and `typeahead.ts`; `StackHeader.test.tsx` (focus, badge, no-match, timeout with fake timers, overlay); `main.test.ts` (key sent and consumed); e2e in `e2e/stacks.spec.ts`.
- Regression considerations: existing Enter/Space/Delete/↑↓ handling and Ctrl+Tab cycling unchanged.

## 13. Rollout / Follow-up

- Rollout plan: ships with the stacks feature, no flag.
- Follow-up work: type-ahead in the stack switcher list.

## 14. Changes during implementation

- The collapsed tree never hides the active row, so requirement 2 reduces to: no rows → nothing happens.
- The menu entry is under File ("Focus Stack"), next to the other stack commands, not View.
- No Playwright e2e test was added: the Electron binary isn't installed in the cloud session, so it could not be run here. Behaviour is covered by unit and jsdom tests; CI e2e runs the existing stacks specs.
- Escape in the full-stack overlay still closes it; Escape with nothing typed in the main tree returns focus to the page.
