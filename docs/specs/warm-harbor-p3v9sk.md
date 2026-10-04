# Feature Specification: Instant home page for a new stack (spare preloaded tab)

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | A new stack (Ctrl/Cmd+N, the + button, start-up after the last stack closes) shows the home page at once by taking over a spare tab that was preloaded at the home page in the background |
| **Spec ID** | warm-harbor-p3v9sk |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-04 10:00 +00:00 |
| **Last updated** | 2026-10-04 11:30 +00:00 |
| **Affected features** | navigation, stacks |
| **Target release** | 0.1.0 |
| **Related links** | specs branching-trail-k4w9zp, silent-orchid-x2m7pd (home page), ADR 0008 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The home page is usually a search page, the thing the user wants to type into right after Ctrl/Cmd+N. Today each new stack creates a page view, starts a renderer process and loads the home page over the network, so the search box appears only after the full cold load, and focus stays in the chrome UI, so the user also has to click into it.
- **Desired outcome:** Ctrl/Cmd+N shows an already loaded home page in the same frame and its search box takes keystrokes immediately.

## 3. Background and Context

- **Current behavior:** `stacks:create` → `openNewStack` → `tabs.create({ url: home })`: a new `WebContentsView` that loads the home page; the chrome UI keeps focus. With no home page (`/home clear`) the new stack opens the prompt.
- **Motivation:** The search page is used as an omnibox replacement; its readiness is the perceived speed of the browser.
- **Related issues or references:** Chromium's spare renderer / NTP preloading.

## 4. Goals

- A new stack at the home page appears without a visible load when a spare is ready.
- Keyboard focus goes into the page, so its autofocused search box receives typing.
- The preloaded page is invisible to history and the stack tree until it is shown.

## 5. Non-Goals

- Preloading anything other than the home page (links, predicted pages).
- Changing the no-home-page path (it still opens the prompt).
- More than one spare.

## 6. User Stories

- As a user, I press Ctrl+N and start typing my search immediately.
- As a user who never opens a new stack, my history doesn't fill with background loads of the search page.

## 7. Functional Requirements

1. Navigation can prepare a tab: `TabControls.prepare(url)` creates a tab in the background that loads the URL (checked with `toUrl`), sized to the page area so it doesn't reflow when shown. Its page events are held, not emitted, until the tab is first activated; then they are emitted in order after `activated`. Returns the tab id, or null for an invalid URL.
2. Stacks keeps one spare tab at the home page while a home page is set: prepared after start-up's stack is opened, again after each spare is taken, and replaced when the home page changes. `/home clear` closes it.
3. A new stack at the home page takes the spare when it is ready (its load has stopped, or it is still loading – showing a loading page is never slower than a new one), binds it, marks it `startRoot` and activates it; the next spare is prepared about 1 s later, so it doesn't compete with the page just shown. Without a spare, the current behaviour applies.
4. Filling an empty current stack (the existing `openNewStack` path) also takes the spare: the empty stack's tab is closed and the spare bound to it.
5. A spare older than 15 minutes is closed and a new one prepared (checked on a timer and before taking it; a too old spare is not used).
6. After a new stack opens at the home page, its page receives keyboard focus (both with and without the spare).
7. A spare whose load fails (`failed` held event, or a non-web URL) is not used; a new one is prepared at the next replacement or take.
8. The spare is never shown in the stack switcher, stored in `stacks.json`, counted against `MAX_STACKS`, or recorded by history before it is taken.

## 8. Non-Functional Requirements

- Performance: taking a ready spare shows the page in the next frame (no network, no renderer start). Only one spare exists at a time.
- Reliability: a spare closed or crashed is replaced; taking never leaves the new stack without a tab.
- Security: the spare is an ordinary page view (`secureWebPreferences`, browsing session, no preload); no new IPC channel.
- Privacy: the home page is fetched in the background while a home page is set (it already is at start); `/home clear` stops it. Nothing is stored for the spare.
- Accessibility: focus moves into the page as if the user clicked it.
- Platforms: all; memory cost is one extra renderer process.

## 9. UX / UI Notes

- User flow: Ctrl+N → the search page is there with a blinking cursor → type.
- Visual considerations: none.
- Edge cases: Ctrl+N twice quickly (second one gets a cold load or the empty-stack rule); home page changed while a spare loads; window resized while the spare is hidden (resized too); assistant running (Ctrl+N is already ignored by the UI).

## 10. Technical Notes

- Proposed approach: in navigation, a `held: TabEvent[] | null` on the `Tab` record; `send` buffers while held, `activate` flushes after `activated`. `prepare` lays out the detached view with the current bounds (and `layout` sizes prepared tabs on resize). In stacks, a `spare: { tabId, url, createdAt }` with `prepareSpare`, `takeSpare` and a 15-minute check; `openNewStack` takes it.
- Process split: main only.
- Dependencies: navigation (`getTabs().prepare`, `focus` of the active tab via `getPage().contents()`).
- Risks / unknowns: background views are throttled by Chromium; the page may finish layout on first show (still no network). Pages that autofocus only on visibility may need a click.
- Open questions: none.

## 11. Acceptance Criteria

- [x] `prepare` loads a tab in the background whose events are held until it is activated, then emitted in order – `navigation/main.test.ts`.
- [x] With a home page, a spare tab exists after start-up; Ctrl/Cmd+N activates it instead of creating and loading a new tab, and a new spare is prepared afterwards – `stacks/main.test.ts`.
- [x] The spare doesn't appear in stacks state or `stacks.json` until taken – `stacks/main.test.ts`.
- [x] Changing or clearing the home page replaces or closes the spare; a spare older than 15 minutes isn't used – `stacks/main.test.ts`.
- [x] After a new stack opens at the home page, the page has keyboard focus – `stacks/main.test.ts`.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: start, wait for the spare, press Ctrl+N and type immediately; `/home clear` and Ctrl+N (prompt opens, no spare); leave the browser 16 minutes and press Ctrl+N.
- Automated test coverage: unit tests above with the fake Electron views; e2e runs in CI only.
- Regression considerations: link-opened stacks, restoring stacks at start, closing the last stack, history recording visits.

## 13. Rollout / Follow-up

- Rollout plan: no flag.
- Follow-up work: measure time-to-interactive of the new stack.

## 14. Changes during implementation

- Navigation also exposes `TabControls.prepared(id)` (loading / loaded / failed) and `focus(id)`, so stacks can skip a failed spare and focus the new stack's page; the 15-minute replacement runs on a timer set when the spare is prepared, plus an age check when it is taken.
- ADR 0011 (Proposed) records the choice of a spare tab.
- e2e (`stacks.spec.ts`) checks that a second Ctrl+N after a pause shows the spare with the page focused; it runs in CI only.
