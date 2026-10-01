# Feature Specification: Hidden menu bar with a `/menu` command in the prompt

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Hide the window's menu bar; reach every menu item through `/menu` in the prompt, with nested suggestions |
| **Spec ID** | slate-compass-m5t2rw |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 15:00 +00:00 |
| **Last updated** | 2026-10-01 16:30 +00:00 |
| **Affected features** | menu (new), prompt |
| **Target release** | 0.1.0 |
| **Related links** | ADR 0003 (application menu from feature contributions), ADR 0007 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** On Windows and Linux the menu bar takes a row of the window above the page, for menus that are mostly reached by keyboard shortcut anyway.
- **Desired outcome:** The menu bar is hidden, so the page gets that space. Every menu item stays reachable: its shortcut still works, and `/menu` in the prompt walks the menu tree with suggestions at each level (`/menu view zoom-in`).

## 3. Background and Context

- **Current behavior:** `src/app/main/menu.ts` builds File (feature items, Quit), Edit, View (reload, dev tools, zoom, full screen) and Window menus (ADR 0003); Electron shows them as a menu bar on Windows and Linux. On macOS the menu lives in the system menu bar and takes no window space.
- **Motivation:** Maximise the page area. The prompt already handles `/commands` with suggestions; menu items fit the same model.
- **Related issues or references:** ADR 0003; prompt's `shared/suggest.ts`.

## 4. Goals

- Goal 1: No menu bar inside the window on Windows and Linux; accelerators keep working.
- Goal 2: `/menu` runs any visible, enabled application menu item, picked level by level with suggestions (IntelliSense-style).
- Goal 3: The menu tree comes from the live application menu, so items features add later show up without changes here.

## 5. Non-Goals

- Non-goal 1: Changing the macOS system menu bar.
- Non-goal 2: Changing menu contents or ADR 0003's contribution model.
- Non-goal 3: An Alt key toggle to bring the menu bar back.

## 6. User Stories

- As a user, I want the page to use the full window height so that I see more of it.
- As a user, I want to type `/menu` and pick a menu, then an item, with suggestions at each step, so that I can still find commands whose shortcut I don't know.

## 7. Functional Requirements

1. On Windows and Linux the window shows no menu bar, and Alt doesn't reveal it. Menu accelerators (Ctrl+L, zoom keys, Ctrl+Shift+I, copy/paste…) keep working.
2. A new feature `menu` exposes the application menu to the chrome UI as a tree: visible items only, no separators, each with a `name` (slug of its label: lower case, mnemonic `&` and `…` removed, other runs of non-alphanumerics → `-`; duplicates among siblings get `-2`, `-3`), the label, its accelerator shown for the platform (`Ctrl+…` / `Cmd+…`), whether it's enabled, and its children for submenus.
3. `/menu <name> <name> …` runs the item at that path. The item runs as if clicked in the menu bar while the page has focus (Edit items act on the page, Toggle Developer Tools opens the page's tools); with no page yet, the chrome UI is the target. On success the prompt's message is cleared.
4. Errors, shown under the prompt, never run anything: an unknown name (lists the choices at that level), a path ending at a submenu (lists its items), a disabled item. `/menu` alone lists the top-level menus.
5. Suggestions: after `/menu `, the prompt suggests the items at the level reached by the names typed so far, filtered by the name being typed (prefix matches before substring matches, on name and label). Each suggestion shows the path (`View › Zoom In`) and the accelerator, or `›` for a submenu. Accepting a submenu fills `/menu view ` and keeps suggesting; accepting an item with Enter runs it, with Tab fills it in.
6. `/menu` is listed with the other commands after `/`.
7. Main validates `menu:run`: an array of 1–8 strings of at most 100 characters each; anything else throws.

## 8. Non-Functional Requirements

- Performance: the tree is a few dozen items, read from the menu when the prompt loads and on Ctrl/Cmd+L.
- Reliability: a menu item that throws reports the error under the prompt.
- Security: two new IPC channels from the chrome UI, `menu:items` (no arguments) and `menu:run` (validated path). They can only do what clicking the menu could; web content gets nothing.
- Privacy: nothing stored or sent.
- Accessibility: suggestions use the existing listbox; every item keeps its keyboard shortcut.
- Platforms: menu bar hiding applies to Windows and Linux; on macOS `/menu` works the same, but Edit role items may act on the focused view (macOS routes them through the first responder).

## 9. UX / UI Notes

- User flow: Ctrl/Cmd+L → type `/me` → Tab (`/menu `) → suggestions File, Edit, View, Window → `v` Tab (`/menu view `) → ↓ to Zoom In → Enter.
- Visual considerations: no new UI; suggestion rows reuse the `value` style.
- Edge cases: items with the same label (hidden duplicate zoom items are skipped as invisible); labels with `&` mnemonics on Windows; a menu changed after startup (tree is re-read on Ctrl/Cmd+L).

## 10. Technical Notes

- Proposed approach: `src/app/main/index.ts` calls `window.setMenuBarVisibility(false)` right after `Menu.setApplicationMenu` (it has no effect before the menu exists). `src/features/menu/main.ts` walks `Menu.getApplicationMenu()` on each request and calls `MenuItem.click(undefined, window, target)` to run an item (role items run their role, others their `click`). Slugs and accelerator formatting live in `menu/shared/`. Prompt's `suggest()` gains generic nested options (`SuggestCommand.tree`), so the prompt doesn't depend on menu internals; `ui/commands.ts` handles `/menu` via `window.antimony.menu.run`.
- Process split: main – tree, run; preload – `menuBridge` (`items`, `run`); UI – prompt's `/menu` command and suggestions. Channels `menu:items`, `menu:run` (UI → main, invoke).
- Dependencies: navigation (`getPage().contents()` for the target), Electron `Menu`/`MenuItem`. No npm packages.
- Risks / unknowns: role items' click target on macOS (see 8). Electron fills role submenus (Edit, Window) and role labels at build time; if a label is missing, the role name is used.
- Open questions: none.

## 11. Acceptance Criteria

- [x] The window has no visible menu bar on Windows/Linux after start (`isMenuBarVisible()` is false) – e2e.
- [x] Menu accelerators still work with the menu bar hidden (Ctrl/Cmd+L focuses the prompt) – e2e.
- [x] The tree skips separators and hidden items, slugs labels, de-duplicates siblings and formats accelerators – unit.
- [x] `/menu view zoom-in` zooms the chrome UI – e2e; running calls the item's click with the window and the page's contents – unit.
- [x] Unknown names, submenu paths, disabled items and invalid arguments are rejected with a message listing the choices – unit.
- [x] Suggestions after `/menu ` follow the tree level by level, filter by the partial name, and a submenu suggestion ends with a space – unit (`suggest.test.ts`, `Prompt.test.tsx`).
- [x] `/menu` appears in the command suggestions – unit.

## 12. Testing / Verification

- Manual test plan: start on Linux/Windows, confirm no menu bar; Ctrl+L, Ctrl+= work; `/menu` → walk to View › Zoom In; `/menu edit select-all` with a page loaded selects the page's text; `/menu file quit` quits.
- Automated test coverage: `menu/shared/*.test.ts`, `menu/main.test.ts`, prompt `shared/suggest.test.ts`, `ui/Prompt.test.tsx`; e2e in `e2e/prompt.spec.ts` / `e2e/app.spec.ts`.
- Regression considerations: `menu.test.ts` (template unchanged); prompt suggestions for other commands unchanged.

## 13. Rollout / Follow-up

- Rollout plan: ships on by default, no flag.
- Follow-up work: a model could call menu items as a tool; recording `/menu` runs in skills.

## 14. Changes during implementation

- **Alt shows the menu bar (Non-goal 3 and requirement 1 changed, owner's choice).** On Linux a menu bar hidden with `setMenuBarVisibility(false)` stops firing its accelerators (seen in e2e). The window is created with `autoHideMenuBar` instead: hidden at start, accelerators work, a lone Alt shows it until Alt again or a click. ADR 0007 records the options.
- **navigation:** `PageArea` re-reports its insets when the chrome UI's viewport size changes; showing the menu bar shrinks the content without a window `resize`, and the page view overlapped it before.
- **`/menu` alone** lists the top-level menus as `/menu <name>` hints (info message, not an error).
- **e2e ran in this session** under `xvfb-run` (Electron binary downloaded with curl): all 12 tests pass. Accelerators are checked with `sendInputEvent` (Ctrl+L in the page).

- **ADR 0007** accepted by the owner.
