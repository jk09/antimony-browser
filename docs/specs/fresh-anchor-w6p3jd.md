# Feature Specification: New-stack page (configurable root page for new stacks)

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | New-stack page: an empty new stack opens a configurable page (default bing.com) as its root |
| **Spec ID** | fresh-anchor-w6p3jd |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-02 09:00 +00:00 |
| **Last updated** | 2026-10-02 20:15 +00:00 |
| **Affected features** | stacks, prompt |
| **Target release** | 0.1.0 |
| **Related links** | [branching-trail-k4w9zp](./branching-trail-k4w9zp.md) (navigation stacks) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** A new stack starts empty: the page area shows the placeholder until the user types a URL or a request.
- **Desired outcome:** Every empty new stack opens a page the user chose (default `https://www.bing.com/`) as its root, so there is something to start from. `/new-stack-page` changes it or turns it off.

## 3. Background and Context

- **Current behavior:** "New stack" in the switcher creates a stack with no nodes and a tab with no page. At start without a stack, and after closing the last stack, there is no stack and no tab.
- **Motivation:** A start page (a search engine by default) is what users expect from a new tab.
- **Related issues or references:** stacks spec branching-trail-k4w9zp; `/history-summaries` (the same on/off/value command pattern).

## 4. Goals

- Empty new stacks load the configured page as their root.
- The page is configurable from the prompt and persists across restarts.
- It can be turned off (today's empty stack).

## 5. Non-Goals

- A settings UI other than the `/new-stack-page` command.
- Changing what links that open a new tab load (they keep loading their own URL).
- A built-in (non-web) new-tab page; only http(s) URLs.

## 6. User Stories

- As a user, I want "New stack" to open my search engine so I can start searching right away.
- As a user, I want to choose another start page, or none, with one command.

## 7. Functional Requirements

1. The new-stack page setting is an http(s) URL or `off`; default `https://www.bing.com/`. Stored in `userData/stacks-settings.json`; an invalid or missing file falls back to the default.
2. When the page is set, it is loaded (transition `typed`) in the new stack's tab, and becomes the stack's root node, when:
   a. "New stack" is chosen in the switcher (`stacks:create`), including when the current stack is empty and has no page yet;
   b. at start, when there is no current stack with a page;
   c. after closing the current stack when no stack is left.
3. With `off`, 2a behaves as today (empty stack, placeholder), and 2b/2c leave no stack, as today.
4. Stacks opened by links (`opened` events) never load the new-stack page.
5. A stack whose root was opened as the new-stack page takes its name from the root's first child (the first page reached from it), not from the start page, so stacks aren't all named `bing`, `bing-2`, … Until then it has no name. This is stored per stack (`startRoot: true`); `stacks.json` files without it stay valid.
6. `/new-stack-page` (prompt):
   - no argument: shows the current page or that it is off;
   - `<url or host>`: validated with navigation's `toUrl`; sets the page; unknown input is an error;
   - `off`: turns it off; `reset`: back to bing.com.
   The setting is validated again in main (`stacks:update-settings`).

## 8. Non-Functional Requirements

- Performance: one extra small JSON file read at start.
- Reliability: a failed load of the start page leaves an empty stack, as a failed typed URL does today.
- Security: new IPC `stacks:settings` (read) and `stacks:update-settings` (`{ newStackPage: string | null }`, http(s) only, validated in main). No new web-content capability; the page loads like any typed URL.
- Privacy: opening a new stack contacts the configured site (bing.com by default); `/new-stack-page off` stops it. The setting itself is stored locally.
- Accessibility: no new UI controls.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: switcher → New stack → the tree shows the start page as root; following a link from it adds a child and names the stack after that page.
- Visual considerations: none new.
- Edge cases: setting changes apply to stacks created afterwards; the empty current stack check (“an empty current stack already is a new one”) loads the page into it instead of doing nothing if it has no page.

## 10. Technical Notes

- Proposed approach: `stacks/main.ts` reads the setting with `createJsonStore`; a helper `openNewStack()` creates (or reuses the empty current) stack, marks `startRoot`, and creates its tab with `tabs.create({ url, activate: true, transition: 'typed' })`. `deriveName` uses the root's first child when `startRoot` is set. Prompt: `new-stack-page` added to `promptCommands` and `runCommand`.
- Process split: main (setting, stack creation), preload (two bridge methods), UI (command only).
- Dependencies: navigation (`toUrl`, `getTabs`); no new npm packages.
- Risks / unknowns: bing.com redirects (e.g. to a locale host); the root node takes the committed URL, which is fine.
- Open questions: none.

## 11. Acceptance Criteria

- [x] "New stack" with the default setting creates a stack whose tab loads `https://www.bing.com/` and whose root node is that page – `stacks/main.test.ts`
- [x] With the setting `off`, "New stack" creates an empty stack and no load – `stacks/main.test.ts`
- [x] At start with no stack, a new stack with the page is opened; after closing the last stack too – `stacks/main.test.ts`
- [x] Link-opened stacks don't load the page – `stacks/main.test.ts`
- [x] A start-page stack is named after the root's first child – `shared/tree.test.ts`
- [x] `stacks:update-settings` rejects non-http(s) and malformed values; the setting persists – `stacks/main.test.ts`, `shared/stored.test.ts` or equivalent
- [x] `/new-stack-page` shows, sets (`toUrl`), turns off and resets the setting – `prompt/ui` tests
- [x] Old `stacks.json` without `startRoot` still loads – stored parsing test

## 12. Testing / Verification

- Manual test plan: `npm run dev`; New stack → bing loads; follow a link → stack named after it; `/new-stack-page example.com`, New stack → example.com; `/new-stack-page off` → empty stack; restart → setting kept.
- Automated test coverage: unit tests listed above; e2e not required (no network in e2e).
- Regression considerations: stacks restore, `/history-clear all`, link-opened tabs.

## 13. Rollout / Follow-up

- Rollout plan: on by default, no flag (small, reversible with `/new-stack-page off`).
- Follow-up work: a built-in new-tab page, if wanted.

## 14. Changes during implementation

- 2c applies only when the current stack is closed and none is left (closing a background stack never opens one).
- End-to-end profiles write a `stacks.json` with `home: null` (`e2e/profile.ts`), so e2e never reaches bing.com.
- The switcher's and `@name` suggestions' page title for a start-page stack is the first child's, matching its name.
- Merged with nimble-anchor-w3p8kd (PR #21), which had added the same setting as the home page: `/home <url>|clear`, `stacks:home|set-home`, stored as `home` in `stacks.json`. This spec now builds on it instead of a second setting: no `/new-stack-page`, `stacks:settings|update-settings` or `stacks-settings.json`. Requirement 6 is `/home` plus `/home reset` (bing.com); `off` is `/home clear`. The default `https://www.bing.com/` applies when `stacks.json` has no `home` (first start, a corrupt file); profiles that already saved `home: null` keep new stacks empty. Without a home page, New stack still opens the prompt (nimble-anchor-w3p8kd).
