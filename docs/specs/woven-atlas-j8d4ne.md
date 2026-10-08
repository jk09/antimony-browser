# Feature Specification: A history map page grouping visited pages by relation and topic

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `/history-map` opens a map of visited pages, grouped by semantic group and connected by link-follows and shared keywords |
| **Spec ID** | woven-atlas-j8d4ne |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-08 12:15 +00:00 |
| **Last updated** | 2026-10-08 14:09 +00:00 |
| **Affected features** | history, prompt |
| **Target release** | 0.1.0 |
| **Related links** | specs ember-ledger-h3x8vq, drifting-nimbus-r8c3kw (Recall page, same layout); ember-console-k5w9tb (command registration) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** History can be searched (list, Recall cloud) but not seen as a whole: there is no view of how visited pages relate to each other or which belong together.
- **Desired outcome:** `/history-map` opens a page over the page area that draws visited pages as nodes, clustered into semantic groups and joined by edges where one page led to another or two pages share keywords. Clicking a node opens the page.

## 3. Background and Context

- **Current behavior:** History stores one row per canonical URL (`pages`: domain, title, keywords, og_type, description, visit counts) and `visits.referrer_page_id` for link and assistant navigations. The Recall page (`RecallView`) already takes the page area's place and shows a keyword or picture cloud for one request.
- **Motivation:** The user asked for a page showing the history as a map, grouped and connected by relations or by belonging to a semantic group.
- **Related issues or references:** Recall layout (`shared/cloud-layout.ts`), `/recall` registration in `prompt/ipc.ts`.

## 4. Goals

- Goal 1: `/history-map` (a prompt command) opens the map page; × or Escape closes it.
- Goal 2: Pages are grouped by local heuristics (no model call) and each group is drawn as a labelled cluster.
- Goal 3: Edges show link-follow relations (referrer) and shared-keyword relations; the two kinds look different.
- Goal 4: The map can be panned and zoomed, filtered by time range and text, and a node opens its page.

## 5. Non-Goals

- Non-goal 1: Model-assigned topics or any new data sent to a model (heuristics only).
- Non-goal 2: Edges for "same site" or "same stack/session" (same-site pages are grouped, not linked).
- Non-goal 3: Editing, deleting or annotating pages on the map (the History panel does that).
- Non-goal 4: Persisting the layout or groups; the map is recomputed on open.
- Non-goal 5: Opening as a normal tab or a menu item (follow-up).

## 6. User Stories

- As a user, I want to see my browsing as clusters of related pages, so I can recall what I was researching.
- As a user, I want to see which page led to which, so I can retrace a path.
- As a user, I want to click a page on the map to open it again.

## 7. Functional Requirements

1. `/history-map` is a built-in prompt command (`usage: ''`, "Show visited pages as a map of groups and relations"); its name is reserved, so no macro can be called `history-map`.
2. Running it asks main (`history:request-map`) to open the page; main sends `history:open-map` to the chrome UI, as Recall does.
3. The page lays over the page area (the page view is hidden while it is open, as on the Recall page), headed "History map", with a time-range selector (24 h, 7 days, 30 days, all; default 7 days) and a filter field that narrows nodes by title, URL or keywords.
4. Main builds the graph (`history:map`, arguments: range, optional text; returns nodes, edges and groups), limited to the 300 most recently visited matching pages.
5. Grouping (deterministic, local): pages sharing a keyword set overlap (Jaccard ≥ 0.3 on `pages.keywords`) or the same domain are merged into one group; a group is labelled with its most frequent shared keyword or, lacking one, its domain; pages with no relation form no group and sit in an "Other" area.
6. Edges: **link** (directed, from `visits.referrer_page_id` to the page, one per pair, weighted by count) and **keyword** (undirected, pages in the same group that share ≥ 2 keywords and have no link edge). Both kinds are distinguishable without colour (solid arrow vs. dashed line) and listed in a legend.
7. Nodes show the page title (domain as fallback) with size by visit count; hovering or focusing shows URL, last visit and keywords. Clicking or pressing Enter on a node opens the page in the active tab and closes the map.
8. The layout is deterministic (same data → same positions), never overlaps nodes, and supports pan (drag) and zoom (wheel, +/− buttons).
9. Empty states: no history "No pages in this range."; filter without matches "Nothing matches."
10. The map refreshes on `history:pages-changed` while open.

## 8. Non-Functional Requirements

- Performance: one SQL read plus in-memory grouping for ≤ 300 pages in under 200 ms; no model request, no screenshots or page text read.
- Security: new UI → main channels `history:request-map` (no arguments) and `history:map` (range enum, text ≤ 200 chars, validated) and one main → UI event `history:open-map`; no new capability for web content or the model. Titles and URLs are rendered as text (React escapes them), never as HTML; sensitive pages are included by title/URL only as elsewhere in history.
- Accessibility: the page is a labelled region; groups are headings in a text list alternative (a visually hidden outline of groups → pages) so the map is usable without pointer; nodes are focusable buttons; Escape closes.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: type `/history-map` → map opens over the page area → change range, filter, pan/zoom, hover for details → click a node (opens the page) or × / Escape.
- Edge cases: single page; one huge group (capped at 300 nodes, with "Showing the 300 most recent of N"); pages deleted while open disappear on refresh; referrer pointing to a page outside the range is drawn only if both nodes are visible.

## 10. Technical Notes

- Proposed approach: `history/main/map.ts` (query + grouping + edges, pure functions over rows) and `history/shared/map-layout.ts` (deterministic force-free layout: groups placed on a grid/spiral, nodes on a ring/spiral inside each group, like `cloud-layout.ts`); `history/ui/MapView.tsx` mounted next to `RecallView` in `App.tsx`, SVG rendering. History IPC gains `requestMap()`, `map()` and `onOpenMap()`; Prompt's `runCommand` handles `history-map`. No schema change (uses existing `pages.keywords`, `domain`, `visits.referrer_page_id`).
- Process split: grouping and edges in main; layout and rendering in the UI.
- Dependencies: history → prompt (`promptCommands` entry); no new npm package.
- Risks / unknowns: pages without keywords yield mostly domain groups; the quality of keyword groups depends on page metadata (acceptable for v1).
- Open questions: none.

## 11. Acceptance Criteria

- [x] `/history-map` is a prompt command and calls `history.requestMap` – UI test (Prompt).
- [x] Main relays `history:request-map` to `history:open-map` – unit test.
- [x] A macro named `history-map` is rejected – unit test.
- [x] Grouping merges pages with keyword overlap ≥ 0.3 or the same domain, labels the group and leaves unrelated pages in "Other" – unit test (`map.ts`).
- [x] Link edges come from `referrer_page_id` (directed, once per pair); keyword edges join grouped pages sharing ≥ 2 keywords without a link edge – unit test.
- [x] The result is limited to 300 most recent pages and respects range and text filter; invalid range or over-long text is rejected – unit test.
- [x] The layout never overlaps nodes and is deterministic – unit test (`map-layout.test.ts`).
- [x] The page renders groups, nodes and both edge kinds with a legend; the filter narrows nodes; empty states show – UI test.
- [x] Clicking a node opens its page and closes the map; Escape and × close it – UI test.
- [x] The map refreshes on `history:pages-changed` – UI test.

## 12. Testing / Verification

- Manual test plan: browse several linked pages on two topics, type `/history-map`, check clusters, edges and legend, change range, filter, zoom, click a node.
- Automated test coverage: unit (history main: map, layout, IPC), UI (MapView, Prompt).
- Regression considerations: Recall page layout, `/recall`, History panel and page recording unchanged.

## 13. Rollout / Follow-up

- Rollout plan: ships enabled, no flag.
- Follow-up work: model-named topics (opt-in, ADR), File menu item, same-stack edges.

## 14. Changes during implementation

Note any deviations from the original spec during implementation.

- End-to-end tests were not run in the cloud session (no Electron binary); CI runs them.
- The group outline for keyboards and screen readers is a visually hidden list of buttons, and the SVG nodes are not focusable themselves.
- Found by running the real app (Electron now installs in cloud sessions): the map takes keyboard focus on opening (the filter field) so Escape works after `/history-map`, and each page keeps at most 3 keyword edges (strongest first), because pages of one topic otherwise joined every pair (1,926 dashed lines for 300 pages).
- Edge routing (follow-up PRs): groups are ordered by swapping to keep links from running through other groups; links between groups are routed through the gaps between boxes (orthogonal search on a 4-unit grid, at most 150 routed, curves for the rest), and links within a group are curves.
- The focused outline button's page shows a focus ring on its map node, so keyboard users can see where they are.
