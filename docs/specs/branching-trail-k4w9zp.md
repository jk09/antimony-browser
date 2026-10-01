# Feature Specification: Navigation stacks (breadcrumb tree in the panel header)

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Navigation stacks: a vertical, branching breadcrumb tree replacing the page title/URL in the assistant panel header, one stack per tab |
| **Spec ID** | branching-trail-k4w9zp |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 18:51 +00:00 |
| **Last updated** | 2026-10-01 19:12 +00:00 |
| **Affected features** | stacks (new), navigation, prompt, agent, history, menu |
| **Target release** | 0.1.0 |
| **Related links** | [still-meridian-r4v8nc](./still-meridian-r4v8nc.md) (assistant panel; its header is replaced here) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The panel header shows only the current page's title and URL. The user can't see how they got there, can't jump back several pages in one click, loses a branch as soon as they go back and follow another link, and every "open in new tab" link replaces the current page because there are no tabs.
- **Desired outcome:** The header shows the navigation of the current tab as a vertical tree of breadcrumbs (root page on top, each followed link one level deeper, branches when the user goes back and follows another link). Clicking a node goes there without changing the tree; only the active node is highlighted. Links that open a new tab start a new stack in its own live tab; stacks have names, can be switched in the header, recalled from the prompt with `@<name>`, attached to a question as context, and survive a restart. Long stacks collapse their middle into a clickable ellipsis that opens the full tree in an overlay.

## 3. Background and Context

- **Current behavior:** `navigation` owns a single `WebContentsView`; `target="_blank"` and `window.open` load into it. The header (`AssistantPanel`) shows the title and URL; back/forward exist only as `/back` and `/forward` skills (Chromium's linear history).
- **Motivation:** Research-style browsing branches: from a search result page (B) the user opens C, goes back, opens C′, goes back, opens C″. A linear back stack forgets C as soon as C′ is opened. A tree keeps every branch one click away and makes the path visible to the user and, through `@name`, to the model.
- **Related issues or references:** The request's screenshot (the panel header outlined in red). `@<name>` follows the `@file` references of the Claude prompt.

## 4. Goals

- Goal 1: The header always shows the current stack as a tree, with the active page highlighted, and clicking any node loads it without restructuring the tree.
- Goal 2: New-tab navigations start a new stack in its own live tab; stacks can be listed, switched, closed and recalled by name.
- Goal 3: `@<name>` in the prompt switches to a stack, or attaches its tree to a question as context.
- Goal 4: Stacks (trees, names, active node, order) are restored after a restart.
- Goal 5: The header never takes more than a bounded height, whatever the tree size.

## 5. Non-Goals

- Non-goal 1: A tab strip, tab drag and drop, multiple windows, or detaching a stack into a window.
- Non-goal 2: Restoring page state (scroll, forms, sessionStorage) across a restart: restored stacks load their active page fresh.
- Non-goal 3: Renaming stacks by hand, reordering stacks, or deleting single nodes (follow-up).
- Non-goal 4: Opener relationships for popups (`window.opener`): new-tab pages open without an opener, as today. OAuth popups that need the opener keep not working.
- Non-goal 5: Changing how history records or searches visits beyond following the active tab (req. 26).
- Non-goal 6: The assistant acting on a stack other than the active one, or `@name` attaching the page text of a stack's pages.

## 6. User Stories

- As a user, I want to see the path that led me to the current page so I know where I am.
- As a user, I want to jump back to any page on that path, or to a branch I left, with one click.
- As a user, I want "open in new tab" links to keep my current page alive and start a separate trail I can come back to.
- As a user, I want to switch to a trail by typing `@its-name`, like referencing a file in Claude.
- As a user, I want to ask the assistant about a trail (`compare the pages in @rust-docs`) without copying URLs.
- As a user, I want my trails back after restarting the browser.

## 7. Functional Requirements

### Tabs (feature `navigation`)
1. `navigation` owns any number of tabs, each a `WebContentsView` with `secureWebPreferences` on the browsing session (unchanged security). Exactly one tab is active and laid out over the page area; the others are removed from the window's content view but keep running (live page state).
2. A new-window request from a page (`target="_blank"`, `window.open`, Ctrl/Cmd+click, middle-click; dispositions `foreground-tab`, `background-tab`, `new-window`) for an http(s) URL creates a new tab loading that URL, with referrer and POST body as today; `foreground-tab` and `new-window` make it active, `background-tab` leaves the current tab active. No `BrowserWindow` is ever created; non-web URLs are still refused.
3. Main-side page controls (`getPage()`) and `onPageEvent()` keep their meaning for the **active** tab: `getPage()` returns the active tab's controls; page events carry a `tabId`, and the existing event types are emitted for every tab. New exports let other features' main code create, activate, close and list tabs and load a URL in a given tab.
4. `navigation:state-changed` keeps reporting the active tab; it is re-sent when the active tab changes.
5. Closing the last tab leaves no tab: the placeholder shows, `getPage().contents()` is null, the state is the empty state.

### Stack model (feature `stacks`, new)
6. Each tab has one **stack**: a tree of **nodes** `{ id, url, title, parentId, children, lastVisitedAt }`, a root, an **active node**, and a **name**. A tab with no page yet has an empty stack.
7. A committed main-frame navigation in a tab updates its stack:
   - started from a stack node (req. 11) → that node becomes active; the tree doesn't change (its URL/title update if the page redirected or retitled);
   - a reload → no change;
   - back/forward (`/back`, `/forward`, the agent's back tool, mouse back buttons) → the parent / the most recently visited child of the active node becomes active (req. 12);
   - anything else (typed URL, link, assistant load, form submit) → a new child node of the active node becomes active. If the active node already has a child with the same URL (ignoring the fragment), that child becomes active instead of adding a duplicate.
8. An in-page navigation that adds a history entry (pushState, fragment link) adds a child node like a link; `replaceState` updates the active node's URL. Title changes update the active node's title.
9. The first navigation of a new tab (req. 2) creates the root of a new stack.
10. A stack's **name** is derived once, when its root gets its first non-empty title (else its host after load): lowercased, non-alphanumerics → `-`, collapsed and trimmed, at most 32 characters; if another open stack has it, `-2`, `-3`… is appended. The name doesn't change afterwards, also when the root is left.

### Moving within a stack
11. Clicking a node in the tree makes it the target: if the tab's Chromium history has an entry with that node's URL at the adjacent index on the current path, it goes there with `goToIndex`; otherwise it loads the node's URL. Either way the commit activates that node (req. 7, first case); no node is added or moved.
12. `/back` goes to the active node's parent, `/forward` to its most recently visited child (none → nothing happens). The navigation state's `canGoBack` / `canGoForward` follow the tree.

### Header tree (feature `stacks`, UI)
13. The panel header shows, top to bottom: the **stack switcher** row (current stack's name, `▾`, and the hide × button as today) and the **tree**. The page title/URL lines of the old header are removed; the active node shows the title and, under it, its URL (one line each, ellipsized; full URL as tooltip).
14. Rows are the tree in depth-first order, children in creation order. Each row is indented one step per depth (12 px), with an `└` / `├` connector to its parent; indentation stops growing at depth 8 (deeper rows show the connector at the maximum indent). Each row shows the page title (else URL) on one line, ellipsized.
15. The active node's row is highlighted (accent background, `aria-current="page"`); a loading indicator shows on it while the tab loads. All other rows are plain; nothing else marks the "current path".
16. Clicking a row (or Enter/Space on it) navigates to it (req. 11). The tree is a `tree` with `treeitem`s; ↑/↓ move between rows, Home/End to first/last.

### Overflow
17. The tree's height is at most **8 rows** and at most **35 %** of the panel's height, whichever is smaller (minimum 3 rows). A larger tree is shown collapsed: the root row, then an **ellipsis row** ("⋯ N more"), then as many rows as fit ending at the last row. If the active row would fall into the hidden part, the visible tail is the rows up to and including the active row, followed by a second ellipsis row for the rows below it.
18. Clicking an ellipsis row opens the **full-stack overlay**: the complete tree, scrollable, laid over the conversation (like history's view) and scrolled to the active row. Clicking a row navigates and closes the overlay; Escape, the overlay's × or a click outside it closes it.

### Stack switcher
19. Clicking the stack name opens a list of all stacks, most recently used first, each with its name, root title and page count; the current one is marked. Clicking one switches to it (activates its tab); its × closes the stack and its tab. A "New stack" item creates an empty tab and switches to it; the next URL typed in the prompt becomes its root.
20. Switching to a stack whose tab isn't live (after a restart) creates the tab and loads the stack's active node's URL; the tree is unchanged.
21. Closing the current stack switches to the most recently used remaining one; closing the last leaves an empty "New tab" state (switcher reads "New tab", empty tree).
22. While the assistant is running (status not `idle`), switching, creating and closing stacks are disabled (the switcher says why), so the assistant keeps acting on the tab it started on.

### `@<name>` in the prompt (feature `prompt`)
23. Typing `@` at the start of a word opens the suggestion list with the open stacks (name, root title), filtered by the typed prefix; Tab/Enter completes `@name `, like `/` commands.
24. A submit whose whole text is `@name` (one known stack, nothing else) switches to that stack, records the text in prompt history as a command, and doesn't call the model.
25. In any other submit to the assistant, each `@name` of a known stack adds a text attachment named `@name` with the stack outline: name, then one line per node (indentation by depth, title, URL, `← current` on the active node), at most 200 nodes (the path to the active node always included). The `@name` text stays in the message. Unknown `@words` stay plain text. Attachment chips show before sending, like pasted text.

### Other features
26. `history` records visits from the **active tab** only, as today; switching tabs is treated like a navigation of the page view to the new tab's current URL with transition `back_forward` (no new visit if it is the visit already open). Background tabs loading don't record visits until shown.
27. `agent` and `menu` keep using `getPage()`, i.e. the active tab.

### Persistence
28. Stacks are saved to `userData/stacks.json` (via `createJsonStore`): for each stack its name, nodes (url, title, parent, lastVisitedAt), active node and last-used time, plus which stack is current. Written at most every 500 ms and on quit.
29. At start the stacks are restored; only the current stack's tab is created, loading its active node's URL as a load started from that node (req. 7, first case: the tree doesn't change). Other stacks get tabs when switched to (req. 20).
30. At most 50 stacks and 500 nodes per stack are kept; beyond that the least recently used stack / the least recently visited leaf nodes not on the active path are dropped. `/history-clear all` also closes all stacks except the current one and trims it to its active node.

## 8. Non-Functional Requirements

- Performance: Background tabs keep running (memory per tab as in Chromium); restored stacks don't create tabs until used. Tree updates are pushed to the UI at most once per animation frame per burst; a 500-node tree renders the collapsed header in under 16 ms.
- Reliability: A crashed tab's renderer (`render-process-gone`) leaves its stack intact; clicking any node reloads it. A corrupt `stacks.json` is moved aside (json-store) and the app starts with no stacks.
- Security: New IPC channels `stacks:list`, `stacks:go-to-node`, `stacks:switch`, `stacks:create`, `stacks:close` (UI → main, every argument validated: ids are known strings) and `stacks:changed` (main → UI), all through `ctx.ipc`. Node URLs are loaded only via `toUrl`/`isWebUrl`. Web content gets no new capability; `secureWebPreferences` unchanged; each new tab uses the same window-open handler and navigation guards.
- Privacy: `stacks.json` stores URLs and titles of pages in open stacks (like open tabs in other browsers); closing a stack deletes it; `/history-clear all` clears them (req. 30). `@name` sends titles and URLs of that stack to the selected model only when the user writes it.
- Accessibility: Tree uses `role="tree"`/`treeitem` with `aria-level`, `aria-current` on the active node and keyboard navigation (req. 16); ellipsis rows are buttons labelled "Show N more pages"; switcher is a `button` with `aria-haspopup="listbox"`; overlay is a dialog labelled "Full stack" and returns focus on close.
- Platforms: Same on all platforms. Mouse back/forward buttons map to `/back` and `/forward` (`app-command` on Windows, `swipe` on macOS as Chromium reports them).

## 9. UX / UI Notes

- User flow: Type `news.ycombinator.com` → root "Hacker News" (stack `hacker-news`) → click a story → child row → click "comments" → grandchild. Click "Hacker News" in the tree → the page goes back, all three rows stay, the root is highlighted. Click another story → a second child of the root (a branch). Middle-click a link → stack `<new page title>` becomes current in its own tab; the switcher shows two stacks. Type `@hacker-news` + Enter → back to the first tab, page state intact.
- Visual considerations:
  ```
  hacker-news ▾                                   ×
  Hacker News
  ├ Show HN: …                         (other branch)
  └ Ask HN: …
     └ Comments | Ask HN: …           ← highlighted
       https://news.ycombinator.com/item?id=…
  ```
  Rows 22 px, `--text`, connectors `--muted`; active row `--accent` tint background with the URL line in `--muted`. Ellipsis row `⋯ 12 more` in `--muted`, pointer cursor. Plain CSS, light and dark.
- Edge cases: Redirect chains → one node (committed URL). Same URL followed from different parents → separate nodes. A page that navigates itself repeatedly (meta refresh, ad redirects) without input → children like links (bounded by req. 30). Error pages (`did-fail-load`) don't add nodes. Very long titles → ellipsized. Narrow panel (300 px) → indentation still capped at depth 8 (96 px). Two stacks with the same root title → `name`, `name-2`.

## 10. Technical Notes

- Proposed approach:
  - `navigation/main.ts`: refactor the single view into a `Tab` record (view, `pending` transition, input timing, guards, window-open handler) keyed by id, with an active id; `layout()`/`show()` act on the active tab. Export `tabs()` controls: `create(url?, { activate })`, `activate(id)`, `close(id)`, `list()`, `load(id, url, transition)`, `goToIndex(id, index)`, `entries(id)`; `onPageEvent` events get `tabId`, and an `activated` event. New-window handler calls `create` (req. 2).
  - `stacks/` (new feature): `shared/tree.ts` pure tree operations (apply a navigation, back/forward targets, name derivation, collapse layout for N rows, outline text for `@name`, pruning) — all unit-tested without Electron. `main.ts` keeps `Map<tabId, Stack>`, subscribes to `onPageEvent`, sets a per-tab "target node" before navigating (req. 11), takes over `/back` / `/forward` targets, persists via `createJsonStore`, and publishes `stacks:changed`. `ui/StackHeader.tsx` (switcher + tree + overflow) and `ui/StackOverlay.tsx`.
  - `prompt`: `AssistantPanel` takes a `header` slot (`App.tsx` passes `<StackHeader />`, like `conversation`/`overlay`), keeping the hide button. `shared/suggest.ts` gains `@` suggestions; `Prompt.tsx` resolves `@name` on submit using `window.antimony.stacks` (switch, or text attachments built by the stacks bridge's `outline(name)`).
  - `skills`: the `/back`/`/forward` built-ins call navigation's back/forward, which `stacks` redirects to tree targets through a hook exported by navigation (`setHistoryResolver`), so skills need no change.
  - `history`: consume `tabId`; ignore events of non-active tabs; on `activated` call `recorder.navigated(url, 200, 'back_forward')` unless it is the open visit.
- Process split: Main: tabs (navigation), stack trees, persistence, IPC (stacks). Preload: `stacksBridge` thin wrappers + `outline` via IPC. UI: header, overlay, `@` suggestions. IPC listed in section 8.
- Dependencies: navigation (tabs, page events), agent (run status for req. 22, `Attachment` type), prompt (panel slot, suggestions), history (active-tab events). Electron `WebContentsView`, `navigationHistory.goToIndex/getAllEntries`. No new npm packages. An ADR records "tabs as live `WebContentsView`s, navigation as a tree owned by `stacks`".
- Risks / unknowns: Keeping Chromium's linear history and the tree in sync (req. 11 falls back to `loadURL`, which re-POSTs nothing and may re-fetch); back-forward cache is only used for adjacent entries. Memory with many live tabs (no tab discarding in this spec). History's recorder assumes one page view; limiting it to the active tab keeps that assumption. Larger refactor of `navigation/main.ts` and its tests.
- Open questions: –

## 11. Acceptance Criteria

- [x] Navigating A → B → C by links gives a stack A ⟶ B ⟶ C with C active (unit: `shared/tree.test.ts`; e2e).
- [x] Clicking A (or B) in the tree loads it, keeps all three rows, and highlights only the clicked row (unit: UI test; e2e).
- [x] From C, going to B and following another link gives B with children C and C′, C′ active (unit; e2e).
- [x] `/back` and `/forward` move to parent / most recently visited child; reload changes nothing; following a link to an existing child's URL reuses it (unit).
- [x] A `target="_blank"` / `window.open` / middle-click link creates a new tab and a new stack; `background-tab` keeps the current tab active; the old tab keeps its page state (unit: `navigation/main.test.ts`; e2e).
- [x] Stack names: derived from the root title, slugged, max 32 chars, unique with `-2` (unit).
- [x] The switcher lists stacks most recently used first, switches, creates and closes them; closing the current switches to the next; closing the last shows "New tab"; all disabled while the assistant runs (unit).
- [x] A tree larger than the limit shows root, ellipsis, tail; the active row is never hidden; clicking the ellipsis opens the full overlay scrolled to the active row; Escape closes it (unit).
- [x] `@` opens stack suggestions; submitting only `@name` switches without a model call; `@name` in a question adds a text attachment with the outline, unknown names stay text (unit: `Prompt.test.tsx`, `suggest.test.ts`).
- [x] Stacks persist to `stacks.json` and are restored at start; only the current stack's tab is created; switching to another creates its tab at its active node (unit with json-store; e2e restart if feasible).
- [x] New IPC channels reject unknown ids and wrong types (unit).
- [x] History records only the active tab's visits and a switch counts as a back/forward visit; agent and menu act on the active tab (unit).
- [x] Limits and `/history-clear all` pruning (unit).
- [x] `npm run check` passes; e2e updated (CI).
- [x] stacks README (new), navigation, prompt, history, agent, menu READMEs, `docs/features.md`, `docs/architecture.md` and a new ADR updated.

## 12. Testing / Verification

- Manual test plan: `npm run dev`; build the A/B/C and C′ scenario on a real site; middle-click links into new stacks and switch between them (check scroll position kept); use `@name` alone and in a question; build a 20-page trail and use the ellipsis and overlay; restart and check stacks; light and dark; keyboard-only through the tree.
- Automated test coverage: Vitest for `stacks/shared/tree.ts`, `stacks/main.ts` (fake navigation tabs), header/overlay UI, prompt `@` handling, navigation tabs and window-open dispositions, history active-tab filtering. Playwright: `e2e/stacks.spec.ts` (local test server pages with links and `target="_blank"`).
- Regression considerations: Every existing navigation invariant (non-web URLs blocked, insets × zoom, `navigation:go` focus), agent tools on the active page, history recording and dwell, `/back` `/forward` skills, prompt suggestions for `/`.

## 13. Rollout / Follow-up

- Rollout plan: Ships enabled with no flag; it replaces the header title/URL.
- Follow-up work: Renaming stacks; discarding background tabs under memory pressure; dragging nodes between stacks; `@name/node` references to a single page; letting the assistant open pages in a new stack; showing favicons in rows.

## 14. Changes during implementation

- **Fragment links on the same page don't add nodes** (req. 8): a navigation to the active page's URL with only another fragment updates the active node, so anchor jumps inside a document don't clutter the tree. pushState to another path still adds a child.
- **`@name` attachments are added on submit, not shown as chips while typing** (req. 25): the outline is fetched when the question is sent; the user turn lists the `@name` attachments. Exceeding the 5-attachment limit shows an error instead of sending.
- **The collapsed tree uses at least 4 lines, not 3** (req. 17): root, ellipsis, active row and a second ellipsis can need 4.
- **The stack list is a dialog of buttons** (switch, × close, + New stack), not a `listbox`, because each entry has two actions.
- **Blocking switches while the assistant runs is enforced in the UI** (switcher, `@name` alone), not in main: main can't see the agent's state without a new dependency.
- **Page-initiated history moves** (`history.back()`) are recognised by the session-history index: navigation reports each navigation's entry change (`new`, `replaced`, `back`, `forward`) and stacks maps back/forward to the matching ancestor/child. navigation also gained `failed`, `opened` and `activated` page events.
- **Mouse back/forward buttons**: Windows `app-command` (`browser-backward` / `browser-forward`) goes through the tree; macOS swipe isn't mapped yet.
- **The tree's 35 % limit is measured against the window height** (the panel is full height).
- **e2e ran in this session** (Electron binary downloaded): all 13 tests pass under `xvfb-run`, including `e2e/stacks.spec.ts` (A → B → C, back by click, branch, new-tab stack, `@name` switch, restart restore). Screenshots of the chrome UI confirmed the tree, ellipsis and overlay in light mode; dark mode uses the existing color tokens and wasn't checked visually.
