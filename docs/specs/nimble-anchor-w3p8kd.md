# Feature Specification: Stack toolbar (reload, new stack, close page)

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Stack toolbar: reload and new-stack buttons at the top of the navigation stack, a close × on every page of the tree, Ctrl/Cmd+R, +N and +W, and a home page for new stacks |
| **Spec ID** | nimble-anchor-w3p8kd |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 20:30 +00:00 |
| **Last updated** | 2026-10-02 09:00 +00:00 |
| **Affected features** | stacks, prompt |
| **Target release** | 0.1.0 |
| **Related links** | [branching-trail-k4w9zp](./branching-trail-k4w9zp.md) (navigation stacks) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The stack header has no visible way to reload the selected page or start a new stack (the latter is hidden in the `@name ▾` list), and a page can't be removed from the tree at all. There are no keyboard shortcuts for these; Ctrl+R reloads the chrome UI instead of the page.
- **Desired outcome:** Two buttons at the top of the stack header – reload the selected page (Ctrl/Cmd+R) and open a new stack at the home page (Ctrl/Cmd+N) – with their shortcuts in their hints, and a × on each page of the tree that closes it and the pages below it (Ctrl/Cmd+W closes the selected page). The home page is a URL set with `/home <url>`.

## 3. Background and Context

- **Current behavior:** `StackHeader` shows the switcher and the tree. New stacks start empty ("New tab"). View › Reload (Electron's `reload` role, Ctrl/Cmd+R) reloads the chrome UI's webContents; on macOS File › Close Window takes Cmd+W. `/reload` is a built-in skill.
- **Motivation:** Browser-standard shortcuts and one-click controls where the user looks at the stack; pruning dead branches keeps the tree short.
- **Related issues or references:** –

## 4. Goals

- Goal 1: Reload and New stack buttons at the top of the stack header, with shortcut hints.
- Goal 2: Close any page of the current stack (with its branch) from the tree, and the selected one with Ctrl/Cmd+W.
- Goal 3: A home page URL that new stacks open at.

## 5. Non-Goals

- Non-goal 1: Undo for closed pages or stacks.
- Non-goal 2: Closing pages of stacks other than the current one.
- Non-goal 3: Opening the home page anywhere other than a new stack (no Home button).

## 6. User Stories

- As a user, I want to reload the page I'm on with a button or Ctrl+R so that I don't need `/reload`.
- As a user, I want Ctrl+N or a button to open a new stack at my home page.
- As a user, I want to close pages (and their branch) I no longer need so that the tree stays short.

## 7. Functional Requirements

1. **Toolbar.** The stack header's top line holds the switcher followed by two icon buttons: Reload (↻) and New stack (+). Their hints (`title`, plus `aria-keyshortcuts`) are "Reload page (Ctrl+R)" and "New stack (Ctrl+N)", with `Cmd` instead of `Ctrl` on macOS.
2. **Reload** reloads the selected (active) page of the current stack, i.e. the page view. Disabled when the current stack has no page.
3. **New stack** creates a stack in a new tab and makes it current (as `+ New stack` does today); if a home page is set the tab loads it, otherwise the stack is empty and the prompt is focused. An empty current stack with no home page set is reused (as today); with a home page set it loads the home page.
4. **Close page.** Each row of the tree (and of the full-stack overlay) has a × button with the hint "Close page" (the active row's hint adds "(Ctrl+W)"); it is visible on the active row and on hover / focus of the others. Closing a page removes it and every page below it. If the active page was among them, its parent becomes active and is loaded. Closing the root closes the whole stack (the same as × in the stack list: the most recently used other stack becomes current, or none).
5. **Shortcuts.** Ctrl/Cmd+R, +N and +W run Reload, New stack and Close page (on the active page) whether the chrome UI or the page has focus; the page doesn't receive them. They're also File menu items ("Reload Page", "New Stack", "Close Page") so `/menu` lists them.
6. While the assistant runs, New stack and Close page are disabled (as switching is) and their shortcuts do nothing; Reload stays enabled.
7. **Home page.** `/home <url>` sets it (any address the location bar accepts, normalised to http(s); otherwise an error), `/home` shows it, `/home clear` removes it. It is stored in `stacks.json` and survives restarts.
8. **Conflicting shortcuts.** View › Reload (chrome UI reload) is removed; View › Force Reload (Ctrl/Cmd+Shift+R) stays for reloading the chrome UI. On macOS File › Close Window moves to Cmd+Shift+W.

## 8. Non-Functional Requirements

- Performance: No change; one extra IPC event per shortcut.
- Reliability: A stored home page that is no longer a web URL is dropped on load (`stacks.json` validation).
- Security: New IPC `stacks:close-node` (node id of the current stack, validated), `stacks:home` / `stacks:set-home` (http(s) URL or null, validated in main), `stacks:command` (main → UI). No new capability for web content; `before-input-event` only consumes the three key combos.
- Privacy: The home page URL is stored locally in `stacks.json`; `/home clear` removes it.
- Accessibility: Buttons have `aria-label`s and `aria-keyshortcuts`; the row × is a real button reachable with Tab from the focused row; tree keyboard navigation (↑ ↓ Home End) is unchanged.
- Platforms: `Cmd` on macOS, `Ctrl` elsewhere, in both handling and hints.

## 9. UX / UI Notes

- User flow: `↻` / Ctrl+R reloads; `+` / Ctrl+N opens a new stack at the home page; hovering a row shows `×`; clicking it removes the branch; Ctrl+W removes the active page's branch and goes to its parent.
- Visual considerations: Small icon buttons in the switcher line, right-aligned; the row × sits at the row's right edge and doesn't make the row taller.
- Edge cases: Close on the only page (root) closes the stack; closing a non-active branch doesn't navigate; Ctrl+W with no stack does nothing; Ctrl+N with the assistant running does nothing.

## 10. Technical Notes

- Proposed approach: `shared/tree.ts` gains `removeBranch(stack, nodeId)` (returns the new active id when the active node was removed). `main.ts` handles `close-node`, `home` and `set-home`, pushes three File menu items and catches the key combos with `before-input-event` on the chrome UI and browsing-session contents (like the prompt's Ctrl/Cmd+B), sending `stacks:command` (`'reload' | 'new' | 'close-page'`) to the UI, which runs the same handlers as the buttons (so the assistant-running check lives in one place). `create` loads the home page when set. Reload uses `navigation.reload()`.
- Process split: main – tree changes, home page storage, key capture; UI – buttons, hints, command handling; prompt UI – `/home`.
- Dependencies: navigation (`toUrl` in the preload for `/home`; main checks http(s)). No new npm packages.
- Risks / unknowns: Removing the `reload` role changes a dev habit (Ctrl+R to reload the chrome UI) – Ctrl+Shift+R still does.
- Open questions: –

## 11. Acceptance Criteria

- [x] The stack header shows Reload and New stack buttons with hints naming Ctrl/Cmd+R and Ctrl/Cmd+N.
- [x] Reload (button and shortcut) reloads the page view.
- [x] New stack (button and shortcut) opens a new current stack at the home page, or empty without one.
- [x] Each row has a × that removes the page and its branch; closing the active page's branch loads its parent; closing the root closes the stack.
- [x] Ctrl/Cmd+W closes the active page; the hint on the active row's × names it.
- [x] New stack and Close page do nothing while the assistant runs.
- [x] `/home <url>`, `/home`, `/home clear` set, show and remove the home page; it survives a restart.
- [x] Ctrl/Cmd+R no longer reloads the chrome UI; macOS Cmd+W no longer closes the window.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: Open a few pages with a branch; try each button and shortcut with focus in the page and in the prompt; set `/home`, press Ctrl+N; restart.
- Automated test coverage: unit – `shared/tree.test.ts` (`removeBranch`), `shared/stored.ts` (home), `main.test.ts` (close-node, home, create with home, IPC validation), `ui/StackHeader.test.tsx` (buttons, hints, ×, commands, disabled while running), prompt `/home`, `app/main/menu.test.ts` (accelerators); e2e – `e2e/stacks.spec.ts` close page.
- Regression considerations: Existing stack list close / new stack; tree keyboard navigation; Ctrl/Cmd+B toggle.

## 13. Rollout / Follow-up

- Rollout plan: Ships enabled, no flag.
- Follow-up work: Undo close; Home button / Alt+Home.

## 14. Changes during implementation

- A focused row also closes with Delete, so non-active pages can be closed from the keyboard (their × isn't in the Tab order).
- An empty new stack (no home page) focuses the prompt by sending prompt's `prompt:open` from stacks' main – a new stacks → prompt dependency (the `ipc.ts` channel only).
- Creating a stack while the current one is empty and a home page is set loads the home page in that stack's tab instead of opening another.
- `/home` overlaps `/me` in prompt suggestions; the `/menu` suggestion test types `/men`.
- End-to-end tests (`e2e/stacks.spec.ts › closes pages…`) were written but not run locally (no Electron binary in the cloud session); CI runs them.
