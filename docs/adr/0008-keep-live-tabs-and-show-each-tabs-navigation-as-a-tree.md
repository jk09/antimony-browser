# 0008. Keep live tabs and show each tab's navigation as a tree

- Status: Proposed
- Date: 2026-10-01
- Features: navigation, stacks, history, prompt
- Spec: branching-trail-k4w9zp

## Context
The panel header only showed the current page, and links that asked for a new window replaced it because there was one page view. The request: a vertical, branching breadcrumb tree per tab in the header, a new stack for every new-tab navigation, stacks recallable by `@name` and kept across restarts. Chromium's session history is linear: going back and following another link drops the forward branch, so it can't be the source of the tree.

## Options considered
1. **Live tabs (one `WebContentsView` per stack) + a tree owned by a new `stacks` feature** – switching keeps page state (scroll, forms, media); more memory per open stack; navigation becomes multi-tab and back/forward must follow the tree.
2. **One page view, stacks only reload their active page on switch** – lighter and simpler; every switch loses page state and re-fetches.
3. **Use Chromium's history as the tree** – no extra model, but branches are lost on the first new navigation after going back.

## Decision
Option 1. navigation owns the tabs (same `secureWebPreferences`, browsing session, guards and window-open handler for every tab; still no `BrowserWindow` for web content) and reports per-tab page events with how the session history changed. stacks owns the trees, persists them in `userData/stacks.json`, and registers a history resolver so back/forward mean parent / last visited child. Going to a node uses the nearest session-history entry with its URL (back-forward cache), else loads the URL; either way the tree keeps its shape. Only the current stack gets a tab at start; others are created when switched to. History records the active tab only.

## Consequences
- Memory grows with live tabs; there's no tab discarding yet (follow-up).
- A node load that isn't in the session history re-fetches the page (no form re-POST).
- `getPage()` means "the active tab" for the agent, history and menu; the assistant can't switch stacks while it runs, so it keeps acting on the tab it started on.
- Open stacks' URLs and titles are stored on disk like open tabs in other browsers; `/history-clear all` clears them.
