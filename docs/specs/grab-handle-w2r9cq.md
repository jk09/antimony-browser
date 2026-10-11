# Feature Specification: Reorder stacks by drag-and-drop in the switcher

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Drag a stack in the switcher's list (or Alt+↑/↓ on it) to change the stack order |
| **Spec ID** | grab-handle-w2r9cq |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-11 10:00 +00:00 |
| **Last updated** | 2026-10-11 10:30 +00:00 |
| **Affected features** | stacks |
| **Target release** | 0.1.0 |
| **Related links** | spec settled-row-h4n6tp (the stack order and `move_stack`; this is its follow-up); PR #74 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Stacks have a stored order (PR #74), but only the assistant can change it.
- **Desired outcome:** The user drags a stack in the switcher's list to a new place, or presses Alt+↑/↓ on a focused row; the order is saved like `move_stack`'s.

## 3. Background and Context

- **Current behavior:** `stacks/main.ts` keeps the order (`place`), the assistant's port moves by name; the UI has no way to move.

## 4. Goals

- Mouse drag-and-drop with a visible drop position.
- A keyboard equivalent.

## 5. Non-Goals

- Dragging stacks out of the list (to another window, the page); dragging pages within a stack's tree.

## 6. User Stories

- As a user, I want to drag "@work" to the top of the stack list so it stays there.

## 7. Functional Requirements

1. **IPC** `stacks:move { stackId, index }` (UI → main): `index` is an integer ≥ 0 (0 = top; past the end = last); `stackId` an open stack. Saves and publishes state.
2. **Drag-and-drop**: each row of the switcher's stack list is draggable. While dragging, the hovered row's upper half marks the gap above it, the lower half the gap below; a 2 px `--focus` line shows the gap and the dragged row fades. Dropping moves the stack there; dropping into its own place does nothing.
3. **Keyboard**: Alt+↑ / Alt+↓ on a row's button moves that stack one place (not past the ends); focus stays on the moved row.
4. **When**: not while the list is filtered (search text) or during the Ctrl+Tab cycle; allowed while the assistant runs (rows' buttons are disabled then, so only dragging works).

## 8. Non-Functional Requirements

- Security: one new IPC channel, sender-checked through `ctx.ipc`, arguments validated.
- Accessibility: rows say "Drag or press Alt+↑/↓ to reorder" (title) and carry `aria-keyshortcuts`.
- Platforms: all; Option on macOS.

## 9. UX / UI Notes

- `cursor: grab` on draggable rows.
- Edge cases: drag ended outside the list (nothing moves); a stack closed while dragging (main rejects the id).

## 10. Technical Notes

- `main.ts`: handler over `place`; `ipc.ts`/`preload.ts`: `move`; `ui/StackHeader.tsx`: drag state `{ id, gap }`, `onRowDragOver`, `onRowDrop`, `onRowKey`; styles in `styles.css`.

## 11. Acceptance Criteria

- [x] `stacks:move` moves a stack by index, saved; bad ids or indexes are rejected – `stacks/main.test.ts › lets the assistant move a stack…`.
- [x] Dragging a row onto another's upper/lower half moves it there; its own place moves nothing; Alt+↑/↓ moves one place; a filtered list can't be reordered – `stacks/ui/StackHeader.test.tsx › reorders stacks by drag-and-drop…`.
- [x] `npm run check` and e2e pass.

## 12. Testing / Verification

- Manual test plan: drag a stack in the open list, restart, check the order; Alt+↑/↓ on a focused row.
- Automated test coverage: unit tests above (jsdom has no `DragEvent`; the test sets the pointer position on the event).

## 13. Rollout / Follow-up

- Rollout plan: no flag.

## 14. Changes during implementation

- Checked once in Electron with a scratch Playwright test (real mouse drag of the third stack onto the first, then Alt+↓; the saved file had the new order); not added to the e2e suite.
- While the assistant runs, the rows' buttons are disabled, so Alt+↑/↓ can't reach them; dragging still works.
