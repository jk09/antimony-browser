# Feature Specification: Open Location

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Open Location |
| **Spec ID** | amber-lantern-8qp2hb |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-09-30 17:29 +00:00 |
| **Last updated** | 2026-09-30 17:56 +00:00 |
| **Affected features** | navigation (new) |
| **Target release** | 0.1.0 |
| **Related links** | [docs/architecture.md](../architecture.md), [quiet-harbor-n7k2x9](./quiet-harbor-n7k2x9.md) (fuller navigation, builds on this) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The app shell opens a window but can't show any web page.
- **Desired outcome:** The user picks **File → Open Location…**, types an address into a plain text box in the toolbar, presses Enter and sees the page.

## 3. Background and Context

- **Current behavior:** The window shows the toolbar and a placeholder with the Chromium version. The application menu is Electron's default.
- **Motivation:** Smallest useful step towards a browser; proves the feature slice (ipc / main / preload / ui) and a page `WebContentsView` end to end.
- **Related issues or references:** ADR 0001, ADR 0002. The Draft spec quiet-harbor-n7k2x9 (address bar, back / forward / reload, search) is follow-up work in the same `navigation` folder.

## 4. Goals

- Goal 1: Load an http(s) page chosen through an application menu item and a text box.
- Goal 2: One page view on the browsing session, laid out under the toolbar and resized with the window.
- Goal 3: A small, reusable way for features to add application menu items.

## 5. Non-Goals

- Non-goal 1: A permanent address bar, showing the current URL, back / forward / reload / stop, loading indicator, page title in the window title (quiet-harbor-n7k2x9).
- Non-goal 2: Search for non-URL input, suggestions, history, tabs.
- Non-goal 3: Error pages for failed loads or crashed pages (Chromium's blank result is acceptable for now).

## 6. User Stories

- As a user, I want to pick "Open Location…" from the menu (or press Ctrl/Cmd+L) and type an address so that I can open a web page.
- As a user, I want a clear message when what I typed isn't a web address so that I can correct it.

## 7. Functional Requirements

1. The application menu has **File → Open Location…** with accelerator `CmdOrCtrl+L`; the accelerator also works while the page has focus. The rest of the menu keeps the standard Edit, View and Window menus (and the app menu on macOS), so copy / paste keep working in the text box.
2. Choosing the item shows a text box (accessible name "Location") in the toolbar and focuses it. Choosing it again while it is shown focuses it and selects its text.
3. Enter turns the input into a URL (FR 4). A valid URL hides the box and loads the URL in the page view, which then gets focus. Invalid input keeps the box open and shows an inline error; typing clears the error.
4. Input handling (`toUrl`), after trimming:
   - input with `://` is used as-is if it is a valid `http:` or `https:` URL;
   - a bare host (with optional port and path), e.g. `example.com`, `example.com:8080/a`, gets `https://`; `localhost` and IP addresses get `http://`;
   - anything else is invalid: empty input, whitespace inside, other schemes (`file:`, `javascript:`, `mailto:`, `about:`, `data:`), single words that aren't `localhost`.
5. Escape hides the text box without loading anything and clears it.
6. Until the first page loads, the placeholder stays visible. From then on the page view fills the window below the 40 px toolbar and follows window resizes.
7. The page view refuses to navigate itself (links, redirects) to anything other than `http:` / `https:`.

## 8. Non-Functional Requirements

- Performance: No work before the first load; one `WebContentsView`, created at startup and added to the window on the first load.
- Reliability: A failed load is logged in the main process and leaves the app usable; the text box can be opened again.
- Security: Page view uses `secureWebPreferences` on the `persist:browsing` session with no preload; `window.open` stays denied (app default). New IPC: `navigation:go` (UI → main, one `string` argument, validated again with `toUrl` in main; anything else is rejected) and `navigation:open-location` (main → UI, no payload). The chrome UI still can't navigate itself.
- Privacy: Nothing is stored by this feature (the browsing session's cookies and cache persist as Chromium does).
- Accessibility: The text box has an accessible name, the error uses `role="alert"`, everything works from the keyboard.
- Platforms: Windows, macOS, Linux; on macOS the File menu follows the app menu and the accelerator is Cmd+L.

## 9. UX / UI Notes

- User flow: File → Open Location… (or Ctrl/Cmd+L) → text box appears in the toolbar, focused → type → Enter → box hides, page loads under the toolbar.
- Visual considerations: Text box sits next to the "Antimony" label, up to 640 px wide, error text to its right; light and dark themes via the existing CSS custom properties.
- Edge cases: menu used while the page has focus; invalid input; blocked schemes; window resized after the first load; loading a second URL replaces the first page.

## 10. Technical Notes

- Proposed approach: new `src/features/navigation/` slice. Pure `to-url.ts` (`toUrl`, `isWebUrl`) shared by main (validation, navigation guard) and UI (inline error).
- Process split:
  - main (`main.ts`): creates the page `WebContentsView`, adds it on the first `navigation:go`, sets bounds on `resize`, guards `will-navigate` / `will-redirect`, contributes the menu item; its click focuses the chrome UI and sends `navigation:open-location`.
  - preload (`preload.ts`): `navigationBridge` with `go(url)` and `onOpenLocation(listener)` (returns an unsubscribe function).
  - UI (`ui/OpenLocation.tsx`): mounted in the toolbar in `App.tsx`.
  - App shell: `MainContext` gains `fileMenu: MenuItemConstructorOptions[]`; features push items; `src/app/main/menu.ts` builds the application menu from them once every feature is registered (ADR 0003, Proposed). Features never call `Menu.setApplicationMenu` themselves.
- Dependencies: Electron `WebContentsView`, `Menu`. No npm packages.
- Risks / unknowns: The toolbar height is a constant in main that must match `--toolbar-height` in `styles.css`. `navigation:open-location` is a command, not a state event, so it doesn't follow the `<noun>-changed` naming.
- Open questions: –

## 11. Acceptance Criteria

- [x] `toUrl` covers full http(s) URLs, bare hosts, hosts with port and path, `localhost:port`, IP addresses, and rejects empty input, whitespace, other schemes and single words (unit tests).
- [x] `navigation:go` rejects non-strings and non-web URLs and loads valid ones; the page view is added on the first load and sized below the toolbar, also after a resize (unit tests).
- [x] The page view blocks navigations to non-http(s) URLs (unit test).
- [x] The menu template has File → Open Location… (`CmdOrCtrl+L`) plus Edit, View and Window menus, and the app menu on macOS only (unit test).
- [x] The text box is hidden until requested, shows an error for invalid input without calling `go`, calls `go` with the normalized URL on Enter and hides; Escape hides it (UI tests).
- [x] E2E: clicking File → Open Location…, typing the URL of a local test server and pressing Enter loads that page in the page view.
- [x] E2E: invalid input shows the error and loads nothing.
- [x] Feature README, docs/features.md and ADR 0003 (Proposed) written.

## 12. Testing / Verification

- Manual test plan: `npm run dev`; open a few real sites through the menu and with Ctrl/Cmd+L while a page has focus; try the edge cases in section 9; resize the window.
- Automated test coverage: unit (Vitest) for `toUrl`, `main.ts` with `electron` mocked, the menu template, and `ui/OpenLocation.tsx`; end-to-end (Playwright, `e2e/navigation.spec.ts`) against a local HTTP server started by the test.
- Regression considerations: `e2e/app.spec.ts` and `App.test.tsx` keep passing.

## 13. Rollout / Follow-up

- Rollout plan: merge to main; no flag.
- Follow-up work: quiet-harbor-n7k2x9 (address bar replaces the text box, back / forward / reload, title, search).

## 14. Changes during implementation

- `toUrl` / `isWebUrl` live in `src/features/navigation/shared/to-url.ts`, not the feature root: the web tsconfig only saw `ipc.ts` and `ui/`. This adds an optional `shared/` folder to the slice layout (pure code used by main and UI), included in both tsconfigs and ESLint's shared boundary group (`src/features/CLAUDE.md`).
- The chrome UI subscribes to `navigation:open-location` after it loads, so a menu click right at startup can be lost; the e2e helper retries the click until the box is focused. Acceptable for real use.
- ADR 0003 is Proposed and needs the owner's acceptance.
