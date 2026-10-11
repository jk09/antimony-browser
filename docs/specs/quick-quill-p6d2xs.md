# Feature Specification: A pencil button to rename stacks

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | ✎ button on each row of the switcher's stack list that starts renaming |
| **Spec ID** | quick-quill-p6d2xs |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-11 13:00 +00:00 |
| **Last updated** | 2026-10-11 13:20 +00:00 |
| **Affected features** | stacks |
| **Target release** | 0.1.0 |
| **Related links** | spec inline-tag-k3v7mb (rename by double-click or F2; this adds the option offered there); PR #77 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Renaming in the switcher is only reachable by double-click or F2, which nothing on screen hints at.
- **Desired outcome:** A ✎ button on each row starts the same inline rename.

## 3. Background and Context

- **Current behavior:** `inline-tag-k3v7mb`: double-click or F2 turns a row's name into a field.

## 4. Goals

- A visible way to start renaming that doesn't switch to the stack.

## 5. Non-Goals

- Changes to the rename rules or the field.

## 6. User Stories

- As a user, I want to see that a stack can be renamed and do it with one click.

## 7. Functional Requirements

1. Each row of the stack list has a ✎ button (`Rename @name`, title `Rename (F2)`) between the sound button and ×; clicking it starts the inline rename of that row, without switching.
2. It shows on the row under the pointer or with focus inside it (always in the accessibility tree); it is hidden while that row is being renamed; disabled while the assistant runs or during Ctrl+Tab, like renaming.

## 8. Non-Functional Requirements

- Accessibility: a real button with an accessible name; reachable with Tab (visible on focus).

## 9. UX / UI Notes

- Decision (user): add the pencil (it was an option when renaming was designed).

## 10. Technical Notes

- `ui/StackHeader.tsx` (button calling `startRename`), `styles.css` (`.stack-list-rename`).

## 11. Acceptance Criteria

- [x] The pencil starts renaming without switching, hides while renaming, is disabled while the assistant runs – `stacks/ui/StackHeader.test.tsx › renames from the pencil button…`.
- [x] `npm run check` and e2e pass.

## 12. Testing / Verification

- Manual test plan: hover a row, click ✎, rename.

## 13. Rollout / Follow-up

- Rollout plan: no flag.

## 14. Changes during implementation

- Checked once in Electron with a scratch Playwright test (hover shows ✎; clicking it focuses the field and doesn't switch); not added to the e2e suite.
