# history

Remembers every page you visit in a local SQLite database, once per canonical URL, with visit times, active dwell time and page metadata, so you can (or the assistant can, with `search_history`) find it again by address, by the words it contained or (with the selected model) by what it was about; a note on a page makes it a bookmark. Pages you stay on for 30 s or more also get a screenshot and, if you turn summaries on, a model-written summary. Recall (`/recall`, or the assistant's `recall_history`) shows the pages that match a request, a sketch or an attached image as a keyword or picture cloud. The history map (`/history-map`) draws visited pages as groups (same site or shared keywords) joined by followed links and shared keywords.

## Entry points
- UI: `ui/HistoryView.tsx` – laid over the conversation in the assistant panel (`overlay` slot in `App.tsx`): search (Text / Meaning), Bookmarks filter, results with thumbnail, snippet, note editor, delete; the current page's note editor on Ctrl/Cmd+D or `/note`
- UI: `ui/RecallView.tsx` – mounted in the workspace (`App.tsx`) and, while open, takes the page area's place (the page view shrinks to nothing): request field, `ui/SketchPad.tsx`, Words / Pictures switch, the cloud (`shared/cloud-layout.ts`), a keyword's pages; opened by `/recall <request>`, File → Recall from History… (Ctrl/Cmd+Shift+Y) or a `history:recall-shown` result of the assistant
- UI: `ui/MapView.tsx` – mounted next to Recall in `App.tsx`, takes the page area's place while open: time range (24 h / 7 d / 30 d / all), filter, SVG map with pan and zoom, groups packed side by side in a landscape grid and ordered so links between groups avoid running through other groups (`shared/map-layout.ts`), link arrows and keyword lines drawn as curves that bend per direction, a hidden outline of groups → pages for keyboards; a node opens its page; opened by `/history-map`, which focuses the filter so Escape closes it
- IPC: `history:suggest|search|screenshot|current|set-note|delete|clear|settings|update-settings|request-open|recall|cancel-recall|request-recall|map|request-map` (UI → main); `history:open`, `history:open-recall`, `history:open-map`, `history:recall-shown`, `history:pages-changed`, `history:settings-changed` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – listens to navigation's `onPageEvent` for the active tab only (switching tabs starts a back/forward visit of the shown page), exports `onHistoryCleared()` (stacks), provides the panel's Text / Meaning search to the assistant's `search_history` (`provideHistorySearch`, up to 20 pages, snippet marks as «») and Recall to `recall_history` (an attached PNG/JPEG becomes the sketch, scaled to 800 px; its own abortable recall next to the Recall page's), tracks activity (window focus/visibility, `powerMonitor` idle and lock), reads metadata with an isolated-world script, captures and summarises at high dwell; File → Note This Page… (Ctrl/Cmd+D). `main/db.ts` schema and queries, `main/recorder.ts` visits and dwell, `main/summarize.ts`, `main/semantic.ts`, `main/recall.ts` (prompt, answer parsing, keyword weights), `main/map.ts` (groups, link and keyword edges for the map, local, no model)
- Shared: `shared/canonical-url.ts`, `shared/fts-query.ts`, `shared/page-meta.ts` (the page script)

## Invariants
- One page per canonical URL: no tracking parameters, credentials, default ports or anchors; sorted query; hash routes kept; rel=canonical only for the same path – `shared/canonical-url.test.ts`
- Single-page app URL changes become visits only after user input and 3 s without change; at most 60 per origin in 5 min – `main/recorder.test.ts`, `e2e/history.spec.ts`
- Only the active tab is recorded; a tab switch is a back/forward visit – `main.test.ts › records only the active tab…`
- Dwell counts only while the window is focused and shown and the user isn't idle; reloads continue a visit – `main/recorder.test.ts`
- Screenshots and summaries exist only for pages with a visit of ≥ 30 s active time (CHECK constraints) and never for pages with password or card fields – `main/db.test.ts`, `main.test.ts`
- Summaries only with `/history-summaries on`; page content goes to the model as untrusted – `main.test.ts`, `main/summarize.test.ts`
- URL suggestions are index range scans; FTS input can't carry FTS syntax – `main/db.test.ts › uses the bare and domain indexes…`, `shared/fts-query.test.ts`
- Semantic search keeps only known ids and falls back to text search, also for the assistant – `main/semantic.test.ts`, `main.test.ts › gives the assistant's search_history…`
- Recall keeps only known ids, clamps scores, normalises keywords and falls back to text matches; screenshots (≤ 16, 320 px) go to the model only with a sketch or an attached image – `main/recall.test.ts`, `main.test.ts › recalls pages…`, `› falls back…`, `› runs the assistant's recall…`, `› refuses images…`
- The cloud never overlaps items and is deterministic, heaviest in the middle – `shared/cloud-layout.test.ts`
- The map is built locally from the 300 most recent matching pages: pages of one domain or with keyword overlap ≥ 0.3 form a group, link edges come from `visits.referrer_page_id`, keyword edges need ≥ 2 shared keywords and no link, and each page keeps at most 3 of them (strongest first); its layout never overlaps – `main/map.test.ts`, `shared/map-layout.test.ts`, `main.test.ts › relays /history-map…`

## Dependencies
- Features: navigation (`onPageEvent`, `getPage`, `getTabs` from `main.ts`), agent (`complete`, `provideHistorySearch` from `main.ts`); stacks listens to `onHistoryCleared`
- App: `createJsonStore`, `ctx.fileMenu` (ADR 0003)
- Electron: `powerMonitor`, `executeJavaScriptInIsolatedWorld` (world 1002), `capturePage`, `nativeImage` (scaling screenshots for Recall); `node:sqlite` with FTS5
- Stored data: `userData/history.sqlite` (WAL, `secure_delete`; `pages`, `visits`, `pages_fts`), `userData/history-settings.json` (`summaries`)

## Security surface
- IPC: the chrome UI reads history (no visible text; screenshots as `data:image/jpeg` URLs), edits notes, deletes pages, clears history and toggles summaries; every argument is validated.
- Web content: a fixed isolated-world script reads metadata and visible text; nothing is injected into the page's own world. With summaries on, text and a screenshot of high-dwell pages go to the selected model; a Meaning search sends candidate titles, URLs, summaries and notes (ADR 0006); the assistant can run Text and Meaning searches and sees up to 20 results (ADR 0012); Recall sends the same, plus with a sketch the sketch and up to 16 small screenshots of candidate pages (ADR 0010); the assistant's `recall_history` does the same with an image the user attached (ADR 0014). The map reads titles, addresses and keywords for the UI (`history:map`, validated range and text) and sends nothing to a model.

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: ember-ledger-h3x8vq, branching-trail-k4w9zp, drifting-nimbus-r8c3kw, patient-archive-h6q2wn, amber-orbit-q7t3vn, woven-atlas-j8d4ne · ADRs: 0003, 0006, 0008, 0010, 0012, 0014
