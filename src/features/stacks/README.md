# stacks

Shows each tab's navigation in the assistant panel header as a vertical, branching tree of breadcrumbs: click any page to go back (or forward) to it without changing the tree, and follow another link to start a branch. Links that open a new tab start a new stack in its own live tab; stacks are named after their first page, switched in the header or with `@name` in the prompt (`@name` inside a question attaches the stack's outline for the model) and come back after a restart. Buttons at the top reload the selected page (Ctrl/Cmd+R) and open a new stack at the home page set with `/home` (Ctrl/Cmd+N); each page's × closes it with its branch (Ctrl/Cmd+W the selected one).

## Entry points
- UI: `ui/StackHeader.tsx` – the panel's `header` slot (`App.tsx`): switcher (`@name ▾`: list, switch, close, New stack; disabled while the assistant runs), ↻ Reload and + New stack buttons (hints name the shortcuts), the tree with a × per row (Delete on a focused row; disabled while the assistant runs) (at most 8 lines and 35 % of the window; longer trees collapse to root, `⋯ N more`, the rows around the active one) and the full-stack overlay
- IPC: `stacks:state|go-to-node|switch|create|close|close-node|outline|home|set-home` (UI → main), `stacks:state-changed` (main → UI, batched per 16 ms), `stacks:command` (main → UI: `reload|new|close-page`, run like the buttons) – `ipc.ts`
- Main: `register` in `main.ts` – one stack per navigation tab; applies `onPageEvent` navigations to the tree, starts navigations from nodes (nearest session-history entry via `goToIndex`, else a load), is navigation's history resolver (back = parent, forward = last visited child), restores the current stack's tab at start; File → Reload Page / New Stack / Close Page (Ctrl/Cmd+R, N, W, also caught in `before-input-event` of the chrome UI and every browsing-session webContents, like Ctrl/Cmd+B); a new stack without a home page opens the prompt
- Shared: `shared/tree.ts` (tree updates, names, collapse layout, outline, pruning, `removeBranch`), `shared/stored.ts` (`stacks.json` validation), `shared/keys.ts` (shortcuts and their hints)

## Invariants
- Following links builds A → B → C; going to a node only moves the active one; a link from B after going back adds a sibling branch – `shared/tree.test.ts`, `e2e/stacks.spec.ts`
- Same page (ignoring the fragment) or a known child is reused, never duplicated; reload and replaceState update the active node – `shared/tree.test.ts`
- Names are slugs of the root title (else host), ≤ 32 chars, unique with `-2`…, set once – `shared/tree.test.ts › names stacks…`
- The collapsed tree never hides the active row – `shared/tree.test.ts › collapses…`, `ui/StackHeader.test.tsx`
- Only the current stack gets a tab at start; others when switched to – `main.test.ts › persists stacks…`
- IPC arguments must name an open stack or a node of the current one; the home page is http(s) or null – `main.test.ts › starts a new stack…`, `› opens new stacks at the home page…`
- Closing a page removes its branch; if it held the active page the parent loads; the root closes the stack – `shared/tree.test.ts › removes a branch…`, `main.test.ts › closes a page…`, `e2e/stacks.spec.ts › closes pages…`
- Ctrl/Cmd+R, N, W reach the UI whether the page or the chrome UI has focus; New stack and Close page do nothing while the assistant runs – `main.test.ts › sends Ctrl/Cmd+R…`, `ui/StackHeader.test.tsx › neither closes…`
- At most 50 stacks, 500 nodes each (old leaves off the active path go); `/history-clear all` keeps only the current stack's active page – `main.test.ts`, `shared/tree.test.ts › prunes…`

## Dependencies
- Features: navigation (`getTabs`, `onPageEvent`, `setHistoryResolver` from `main.ts`; `navigation.reload` bridge), history (`onHistoryCleared` from `main.ts`), agent (`AgentState` type: switching is disabled while it runs), prompt (`prompt:open` channel to focus the prompt for an empty new stack); prompt hosts the header and calls this bridge for `@name` and `/home`
- App: `createJsonStore`
- Stored data: `userData/stacks.json` (names, URLs and titles of open stacks' pages; closing a stack or page deletes it; the home page URL, removed by `/home clear`)

## Security surface
- IPC: the chrome UI reads stacks and their outlines, loads a stack node's URL (only http(s), checked by navigation), switches, creates and closes stacks, closes pages and sets the home page (http(s) only).
- Keys: consumes Ctrl/Cmd+R, N and W before web pages see them.
- Web content: – (new-tab handling is navigation's)

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: branching-trail-k4w9zp, nimble-anchor-w3p8kd · ADRs: 0008
