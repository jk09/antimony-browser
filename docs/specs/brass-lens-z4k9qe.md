# Feature Specification: Zoom the chrome UI

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Zoom the chrome UI with Ctrl/Cmd + / − / 0 |
| **Spec ID** | brass-lens-z4k9qe |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 10:00 +00:00 |
| **Last updated** | 2026-10-01 10:30 +00:00 |
| **Affected features** | navigation, – (app shell: `src/app/main/menu.ts`, `src/app/main/index.ts`) |
| **Target release** | 0.1.0 |
| **Related links** | [still-meridian-r4v8nc](./still-meridian-r4v8nc.md) (assistant side panel) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Ctrl+− zooms the chrome UI (Electron's View menu roles), but the page view is laid out from the page area's box in CSS pixels while main sizes it in window pixels. Zoomed out, the assistant panel shrinks on screen but the page view keeps the old right inset, leaving an empty strip between the page and a narrow panel. Ctrl+= (without Shift) and the keypad keys don't zoom in.
- **Desired outcome:** Ctrl/Cmd + / − / 0 zoom the whole chrome UI (assistant panel, debugger, placeholder) in fixed steps, and the page view always fills the page area exactly, at any zoom.

## 3. Background and Context

- **Current behavior:** The View menu is Electron's `viewMenu` role. Its zoom items act on whatever webContents Electron picks and use 0.5 zoom-level steps without limits. `PageArea` reports insets in CSS pixels; `navigation` uses them as window pixels; insets only re-report when their CSS values change, which a zoom doesn't do for the panel's width.
- **Motivation:** Screenshot from the user: chrome UI zoomed out, panel tiny, page view not reaching it.

## 4. Goals

- Goal 1: Zoom in / out / reset of the chrome UI from the keyboard (Ctrl/Cmd with `+`, `=`, `-`, `0`, keypad `+`, `-`, `0`) and the View menu.
- Goal 2: The page view's bounds match the page area at every zoom, updated as soon as the zoom changes.

## 5. Non-Goals

- Zooming web pages (the page view keeps 100 %; a page-zoom feature is separate, docs/architecture.md item 7).
- Remembering the zoom across restarts; Ctrl+wheel zoom.
- Keeping the assistant panel's on-screen width constant while zooming: the panel's width is in UI pixels and scales with the zoom like the rest of the UI.

## 6. User Stories

- As a user, I want to make the assistant panel's text bigger or smaller with Ctrl+plus / Ctrl+minus, and back with Ctrl+0.
- As a user, I want the page to stay right next to the panel whatever the zoom.

## 7. Functional Requirements

1. The View menu keeps Reload, Force Reload, Toggle Developer Tools and Toggle Full Screen, and has Actual Size (Ctrl/Cmd+0), Zoom In (Ctrl/Cmd+Plus) and Zoom Out (Ctrl/Cmd+−). Hidden items add Ctrl/Cmd+=, keypad + / − / 0 to the same actions.
2. Zoom acts on the chrome UI's webContents only, wherever the keyboard focus is (prompt or page).
3. Zoom factors step through 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250 and 300 %; zooming beyond the ends does nothing. From a factor between steps, zoom moves to the next step in that direction.
4. `navigation` multiplies the reported insets by the chrome UI's zoom factor before laying out the page view.
5. `PageArea` reports its insets again when `devicePixelRatio` changes (a zoom), even if the CSS values are the same.

## 8. Non-Functional Requirements

- Performance: one extra `set-insets` call per zoom step.
- Security: no new IPC channels; `set-insets` validation unchanged (still CSS pixels from 0 to 4000). `secureWebPreferences` unchanged.
- Accessibility: zoom is the accessibility gain; menu items are labelled.
- Platforms: Ctrl on Windows/Linux, Cmd on macOS.

## 9. UX / UI Notes

- Zooming the UI scales the panel's text and its width together; the page view takes whatever is left.

## 10. Technical Notes

- `src/app/main/zoom.ts`: pure `nextZoomFactor(current, direction)`.
- `appMenuTemplate` gets a `zoom(direction)` callback; `index.ts` passes one that sets `window.webContents` zoom factor.
- `navigation/main.ts` `layout()` scales insets by `window.webContents.getZoomFactor()`.

## 11. Acceptance Criteria

- [x] `nextZoomFactor` steps, stops at the ends and snaps from in-between factors (unit: `zoom.test.ts`).
- [x] The View menu has the zoom items with their accelerators, including hidden aliases, and calls `zoom` with the right direction (unit: `menu.test.ts`).
- [x] The page view's bounds are the insets times the chrome UI's zoom factor (unit: `navigation/main.test.ts`).
- [x] `PageArea` re-reports insets when `devicePixelRatio` changes (unit: `App.test.tsx` or `PageArea` test).
- [x] e2e: after zooming the chrome UI out, the page view's right edge meets the assistant panel's left edge (`e2e/app.spec.ts`; CI).

## 12. Testing / Verification

- Manual: `npm run dev`, load a page, Ctrl+− several times, Ctrl+=, Ctrl+0 with focus in the prompt and in the page; the page always meets the panel.
- Automated: Vitest as above; Playwright in CI.

## 13. Rollout / Follow-up

- Ships enabled, no flag. Follow-up: remember the zoom; page zoom.

## 14. Changes during implementation

- **The PageArea re-report test lives in `App.test.tsx`**, which already mounts `PageArea` with the fake API.
- **e2e ran in this session** under `xvfb-run` (Electron binary downloaded): all 10 tests pass; the new zoom test fails without the inset scaling (page edge doesn't meet the panel).
