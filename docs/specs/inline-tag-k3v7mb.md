# Feature Specification: Rename stacks in the switcher

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Double-click a stack (or F2) in the switcher's list to rename it |
| **Spec ID** | inline-tag-k3v7mb |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-11 12:00 +00:00 |
| **Last updated** | 2026-10-11 12:40 +00:00 |
| **Affected features** | stacks |
| **Target release** | 0.1.0 |
| **Related links** | spec fresh-label-n5j8ve (`rename_stack`; this is its follow-up); PR #76 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Only the assistant can rename a stack (`rename_stack`).
- **Desired outcome:** In the open stack list, double-click a stack or press F2 on its row, type a name, Enter.

## 3. Background and Context

- **Current behavior:** `stacks/main.ts` renames through the agent's port only; a click on a row switches at once and closes the list.

## 4. Goals

- Inline renaming with the same name rules as `rename_stack`, and a preview of the resulting `@name`.

## 5. Non-Goals

- Renaming from the header button itself; renaming pages.

## 6. User Stories

- As a user, I want to rename `@the-mathocalypse-hacker-news` to `@hn` from the switcher.

## 7. Functional Requirements

1. **IPC** `stacks:rename { stackId, name }` (UI → main): `name` a string ≤ 200 characters; same rules as the port (slug, ≤ 32, `-2`… when taken, unchanged without letters or digits); resolves with the stack's name.
2. **Start**: double-click a row, or F2 on its focused row. Not while the assistant runs or during Ctrl+Tab (as switching).
3. **Field**: the row shows a text field with the name selected and a note: `Enter: @<preview> · Escape: cancel`, or `Use letters or digits · Escape: cancel`. The preview uses the shared `slug`/`uniqueName` against the other stacks' names.
4. **End**: Enter saves (nothing is sent without letters or digits); Escape or leaving the field cancels; focus returns to the row; the list stays open.

## 8. Non-Functional Requirements

- Security: one new IPC channel through `ctx.ipc`, arguments validated.
- Accessibility: the field is labelled `New name for @name` and described by the note; rows carry `aria-keyshortcuts` F2.

## 9. UX / UI Notes

- Decision (user): leaving the field cancels (not saves).

## 10. Technical Notes

- `main.ts`: `rename` shared by the port and the IPC handler. `ui/StackHeader.tsx`: `renaming` state, `startRename`/`endRename`, `renamePreview`.

## 11. Acceptance Criteria

- [x] `stacks:rename` renames by id, resolves with the name, rejects bad ids and names – `stacks/main.test.ts › lets the assistant rename a stack…`.
- [x] Double-click or F2 opens the field with the name selected; the preview shows the slug and -2; Enter renames, an unusable name or Escape doesn't; focus returns to the row – `stacks/ui/StackHeader.test.tsx › renames a stack by double-click or F2…`.
- [x] A double-click doesn't switch; a single click still does – `› switches after a single mouse click…`.
- [x] `npm run check` and e2e pass.

## 12. Testing / Verification

- Manual test plan: double-click a stack, type a name another stack has, check the preview, Enter.

## 13. Rollout / Follow-up

- Rollout plan: no flag.

## 14. Changes during implementation

- A mouse click on a row used to switch at once and close the list, so the second click of a double-click never arrived. A mouse click now switches after 250 ms (`RENAME_CLICK_MS`) unless a second click follows; Enter/Space (keyboard clicks) and the existing e2e switches are unaffected apart from that delay.
- Checked once in Electron with a scratch Playwright test (double-click, type a taken name, preview `@alpha-2`, Enter, then a single click switches); not added to the e2e suite.
