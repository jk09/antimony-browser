# Feature Specification: Navigation

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Navigation |
| **Spec ID** | quiet-harbor-n7k2x9 |
| **Status** | Draft <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-09-30 14:38 +00:00 |
| **Last updated** | 2026-09-30 14:38 +00:00 |
| **Affected features** | navigation (new) |
| **Target release** | 0.1.0 |
| **Related links** | [docs/architecture.md](../architecture.md) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The app shell opens a window but can't show web pages.
- **Desired outcome:** A single-page browser: type a URL or search terms, see the page, go back, forward, reload or stop.

## 3. Background and Context

- **Current behavior:** The window shows the toolbar and a placeholder with the Chromium version.
- **Motivation:** First real feature; proves the feature-slice pattern (ipc / main / preload / ui) end to end.
- **Related issues or references:** ADR 0001, ADR 0002.

## 4. Goals

- Goal 1: Load any http(s) page typed into an address bar.
- Goal 2: Back, forward, reload and stop behave like in Chrome.
- Goal 3: The UI always shows the current URL, loading state and page title.

## 5. Non-Goals

- Non-goal 1: Tabs, history, bookmarks, address bar suggestions (later specs).
- Non-goal 2: Configurable search engine (fixed default for now).

## 6. User Stories

- As a user, I want to type a URL or search terms and press Enter so that I get to the page I want.
- As a user, I want back, forward and reload buttons so that I can move between pages I visited.

## 7. Functional Requirements

1. The toolbar has back, forward, reload/stop buttons and an address bar; the page fills the rest of the window and resizes with it.
2. Address bar input is turned into a URL: full URLs are used as-is (http, https only), `example.com`-like input gets `https://`, anything else becomes a search on the default engine.
3. Enter in the address bar loads the input in the page view; Escape restores the current URL.
4. The address bar shows the current URL after every navigation (including in-page and redirects), unless the user is editing it.
5. Back and forward are disabled when not possible; reload turns into stop while loading.
6. The window title is `<page title> – Antimony`.
7. Keyboard: Ctrl/Cmd+L focuses the address bar, Alt+Left / Alt+Right (Cmd+[ / ] on macOS) go back and forward, Ctrl/Cmd+R and F5 reload – also while the page has focus.
8. On start the page view shows a blank page and the address bar is focused.

## 8. Non-Functional Requirements

- Performance: Toolbar state updates within one frame of the navigation event.
- Reliability: A crashed page renderer shows an error message and reload recovers it.
- Security: Page view uses `secureWebPreferences` on the browsing session with no preload; only `http:`, `https:` and `about:blank` are loaded; IPC input is validated. New channels: `navigation:go`, `navigation:back`, `navigation:forward`, `navigation:reload`, `navigation:stop`, `navigation:state-changed`.
- Privacy: Nothing is stored by this feature.
- Accessibility: Buttons have accessible names; everything works with the keyboard.
- Platforms: Windows, macOS, Linux; macOS uses Cmd shortcuts.

## 9. UX / UI Notes

- User flow: start → address bar focused → type → Enter → page loads, URL and title update.
- Visual considerations: Chrome-like toolbar, 40 px high, light and dark themes.
- Edge cases: invalid URL, non-http schemes (`file:`, `javascript:`) typed by the user, network errors, page crash, `window.open` (denied for now).

## 10. Technical Notes

- Proposed approach: `src/features/navigation/` slice as in docs/architecture.md; one `WebContentsView` owned by `main.ts`; pure `toUrl(input)` for input parsing.
- Process split: main owns the view and navigation; UI renders the toolbar and calls `window.antimony.navigation`; main pushes `NavigationState` on `did-navigate`, `did-navigate-in-page`, `did-start-loading`, `did-stop-loading`, `page-title-updated`.
- Dependencies: Electron `WebContentsView`, `Menu` accelerators for shortcuts. No npm packages.
- Risks / unknowns: Toolbar height has to match the view bounds; Menu accelerators vs. page shortcuts.
- Open questions: Default search engine (proposal: DuckDuckGo)?

## 11. Acceptance Criteria

- [ ] `toUrl` covers URLs, bare hosts, `localhost:port`, search terms and blocked schemes (unit tests).
- [ ] E2E: typing a URL of a local test server and pressing Enter shows that page and its title in the window title.
- [ ] E2E: back and forward return to the previous and next page; the buttons' disabled state matches.
- [ ] E2E: reload reloads; stop is shown while loading.
- [ ] Page view resizes with the window and never covers the toolbar.
- [ ] IPC handlers reject invalid arguments (unit tests).
- [ ] Feature README and docs/features.md updated.

## 12. Testing / Verification

- Manual test plan: browse a few real sites; try the edge cases in section 9.
- Automated test coverage: unit (Vitest) for `toUrl` and IPC validation; end-to-end (Playwright, `e2e/navigation.spec.ts`) against a local HTTP server started by the test.
- Regression considerations: e2e for the app shell keeps passing.

## 13. Rollout / Follow-up

- Rollout plan: merge to main; no flag.
- Follow-up work: tabs spec.

## 14. Changes during implementation

Note any deviations from the original spec during implementation.
