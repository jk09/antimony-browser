# Feature Specification: Stack panel as its own card, with a focus state and a search box

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Redesign of the stack panel (assistant panel header): a separate card that shows when it has focus, and a search box that replaces type-ahead |
| **Spec ID** | copper-beacon-k5r8tw |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-04 09:00 +00:00 |
| **Last updated** | 2026-10-04 16:00 +00:00 |
| **Affected features** | stacks |
| **Target release** | 0.1.0 |
| **Related links** | spec silent-orchid-x2m7pd (Ctrl/Cmd+E and type-ahead) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The stack panel at the top of the assistant panel blends into the conversation and the prompt below it: same background, only a thin line between them, and no sign that it has keyboard focus. Type-ahead (prefix of the title, dropped after a second, invisible until typed) misses pages users expect it to find.
- **Desired outcome:** The stack panel is a card of its own, clearly apart from the conversation and the prompt card, that lights up while it has focus. A search box in its top row finds pages by any part of their title or URL; typing while the panel has focus goes into it.

## 3. Background and Context

- **Current behavior:** `StackHeader` sits in `.assistant-header` on the panel background with a bottom border. Ctrl/Cmd+E focuses the active row; letters typed in the tree jump to the next row whose title starts with them (`shared/typeahead.ts`), with a `typing:` badge.
- **Motivation:** User feedback on the panel (screenshot, 2026-10-04): hard to tell when it is selected, hard to tell apart from the prompt, search unreliable.

## 4. Goals

- The stack panel looks like a separate card, unlike the conversation and the prompt card.
- The card shows a strong focus state while focus is inside it.
- A search box between the stack name and the ↻ / + buttons searches the current stack; typing a character in the tree moves to the box with that character.

## 5. Non-Goals

- Searching other stacks or history.
- Changing the tree layout (collapse, ellipses, full-stack overlay) or the shortcuts.

## 6. User Stories

- As a user, I press Ctrl+E and see the stack panel light up; I type "air" and see every page whose title or URL contains it; Enter opens the first.
- As a user, I glance at the assistant panel and see where the tab stack ends and the conversation starts.

## 7. Functional Requirements

1. The stack header is drawn as a card (own background, border, rounded corners, margin) set apart from the conversation and the prompt card.
2. While focus is anywhere in the stack panel (tree, search box, buttons) the card shows a focus ring in the focus colour, and the active row in a focused tree is marked more strongly.
3. A search box (`Search pages`) sits in the top row, between the stack switcher and the ↻ / + buttons.
4. A non-empty query replaces the tree with the pages of the current stack whose title or URL (the URL without its scheme and `www.`) contains every whitespace-separated word of the query (case-insensitive), in tree order, each with its URL and the matched text highlighted; "No matching pages" when none.
5. In the box: ↓/↑ move the highlighted result (wrapping), Enter goes to it and clears the query, Escape clears the query and returns focus to the active row (Escape with an empty box returns to the active row too). Clicking a result goes to it.
6. A printable key (no Ctrl/Cmd/Alt) typed while a tree row or ellipsis has focus moves focus to the search box and starts the query with that character; Space on a row still opens it. Escape in the tree still returns to the page.
7. The type-ahead (prefix jump, `typing:` badge, 1 s timeout) is removed.

## 8. Non-Functional Requirements

- Performance: filtering ≤ 500 rows per keystroke, no IPC.
- Reliability: the query is kept until cleared, not dropped on a timer.
- Security: no new IPC, keys or stored data.
- Privacy: the query is not stored.
- Accessibility: the box is a labelled combobox controlling a listbox of results with `aria-activedescendant`; the result count is announced.
- Platforms: all.

## 9. UX / UI Notes

- User flow: Ctrl+E → card ring → type → results → ↓ / Enter → page loads, tree back.
- Visual considerations: card uses `--card-bg` with a neutral border so it differs from the accent-bordered prompt card; the body (conversation) keeps the panel background.
- Edge cases: no stack (box hidden); results longer than the tree's row limit scroll; a stack change while searching keeps the query and refilters.

## 10. Technical Notes

- Proposed approach: `shared/search.ts` (pure `searchRows`, match ranges) replaces `shared/typeahead.ts`; `StackHeader` renders the box and the result list; styles in `styles.css`.
- Process split: UI only.
- Dependencies: none new.
- Risks / unknowns: none.
- Open questions: none.

## 11. Acceptance Criteria

- [x] The stack panel is a card separate from the conversation and the prompt card.
- [x] The card shows a focus ring while focus is inside it.
- [x] The search box sits between the stack name and the ↻ / + buttons and finds pages by any words of title or URL.
- [x] ↓/↑/Enter/Escape and clicks work in the box as in requirement 5.
- [x] Typing a letter in the tree moves it into the search box; Space and Escape in the tree work as before.
- [x] Type-ahead code and its badge are gone.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: Ctrl+E, type, arrows, Enter, Escape; check light and dark themes.
- Automated test coverage: `shared/search.test.ts`; `ui/StackHeader.test.tsx › Ctrl+E and search`.
- Regression considerations: Ctrl/Cmd+E, Delete on rows, full-stack overlay.

## 13. Rollout / Follow-up

- Rollout plan: none (no flag).
- Follow-up work: search across all stacks.

## 14. Changes during implementation

- Search skips the URL's scheme and `www.` (a single `h` would otherwise match every `https` URL).
- Implemented without stopping for spec approval; the user's request stated the scope.
