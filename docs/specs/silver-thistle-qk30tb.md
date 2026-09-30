# Feature Specification: Open new-window links in the page view

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Open new-window links in the page view |
| **Spec ID** | silver-thistle-qk30tb |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-09-30 18:25 +00:00 |
| **Last updated** | 2026-09-30 18:31 +00:00 |
| **Affected features** | navigation |
| **Target release** | 0.1.0 |
| **Related links** | [amber-lantern-8qp2hb](./amber-lantern-8qp2hb.md) (Open Location), [quiet-harbor-n7k2x9](./quiet-harbor-n7k2x9.md) (fuller navigation) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** After loading a page with File → Open Location…, clicking many of its links does nothing. Links that open a new window (`target="_blank"`, `window.open`, Ctrl/Cmd-, Shift- or middle-click) are dropped silently, because the app denies every new window and there are no tabs yet.
- **Desired outcome:** Such links open in the existing page view, like ordinary links.

## 3. Background and Context

- **Current behavior:** Ordinary links navigate the page view (verified with a real mouse click under Xvfb). New-window links hit the app-wide `setWindowOpenHandler(() => ({ action: 'deny' }))` from `hardenApp` and nothing happens.
- **Motivation:** Many sites open links in a new window; the browser looks broken on them.
- **Related issues or references:** Architecture "Suggested feature order" puts `window.open` → new tab in the future **tabs** feature; this is the single-view stop-gap until then.

## 4. Goals

- Goal 1: Every new-window request for an http(s) URL from the page loads that URL in the page view.
- Goal 2: No new windows or `WebContents` are ever created for web content.

## 5. Non-Goals

- Non-goal 1: Tabs, popups, or real new windows (tabs feature).
- Non-goal 2: A popup blocker or user-gesture check.
- Non-goal 3: Handling non-web URLs (`mailto:` etc.) by passing them to the OS.

## 6. User Stories

- As a user, I want links that would open a new window to open in the page I'm looking at so that I can follow them at all.

## 7. Functional Requirements

1. The navigation feature sets its own window-open handler on the page view, replacing the app default for that view. It always returns `{ action: 'deny' }`.
2. If the requested URL passes `isWebUrl`, the handler loads it in the page view (same path as `navigation:go`: errors are logged, the page keeps focus), passing the referrer and, for `target="_blank"` form posts, the post body and its content type.
3. Any other URL (`about:blank`, `javascript:`, `file:`, `mailto:` …) loads nothing.
4. The `will-navigate` / `will-redirect` guard is unchanged.

## 8. Non-Functional Requirements

- Performance: No extra views; one handler.
- Reliability: A failed load is logged, as with `navigation:go`.
- Security: No new IPC. Web content still can't create windows. New capability: a page (or an iframe in it) calling `window.open(url)` navigates the page view to that http(s) URL, including without a user gesture. A top-level page can already do this with `location.href`; a cross-origin iframe normally needs a user gesture to navigate the top page. Accepted until the tabs feature replaces this with real tabs (and can add a popup policy).
- Privacy: Nothing stored.
- Accessibility: –
- Platforms: Same on all platforms.

## 9. UX / UI Notes

- User flow: click a `target="_blank"` link → the page view shows the linked page.
- Edge cases: `window.open()` with no URL (`about:blank`) does nothing; `window.open('javascript:…')` does nothing; the opener gets `null` back.

## 10. Technical Notes

- Proposed approach: in `src/features/navigation/main.ts`, `page.webContents.setWindowOpenHandler(...)` after creating the view. Extract the "load in page, log failures" code shared with `navigation:go`.
- Process split: main only.
- Dependencies: Electron `setWindowOpenHandler`, `loadURL` options (`httpReferrer`, `postData`, `extraHeaders`).
- Risks / unknowns: see Security.
- Open questions: –

## 11. Acceptance Criteria

- [x] The window-open handler denies every request, loads http(s) URLs in the page view with the referrer, and loads nothing for other URLs (unit test).
- [x] E2E: clicking a `target="_blank"` link in a loaded page loads the linked page in the page view and creates no other `WebContents`.
- [x] Navigation README (entry points, invariants, security surface) updated.

## 12. Testing / Verification

- Manual test plan: `npm run dev`; open a page with `target="_blank"` links (e.g. a GitHub README's external links); click, Ctrl-click and middle-click them.
- Automated test coverage: unit (`main.test.ts`), end-to-end (`e2e/navigation.spec.ts`, local test server).
- Regression considerations: existing navigation tests keep passing.

## 13. Rollout / Follow-up

- Rollout plan: merge to main; no flag.
- Follow-up work: tabs feature opens these in new tabs instead.

## 14. Changes during implementation

- The Security surface in the navigation README records the new `window.open` behaviour; no ADR, since the architecture baseline already allows a feature to handle `window.open` ("denied unless a feature handles it").
