# history

Remembers every page you visit in a local SQLite database, once per canonical URL, with visit times, active dwell time and page metadata, so you can find it again by address, by the words it contained or (with the selected model) by what it was about; a note on a page makes it a bookmark. Pages you stay on for 30 s or more also get a screenshot and, if you turn summaries on, a model-written summary. Recall (`/recall`) shows the pages that match a request or a sketch as a keyword or picture cloud.

## Entry points
- UI: `ui/HistoryView.tsx` – laid over the conversation in the assistant panel (`overlay` slot in `App.tsx`): search (Text / Meaning), Bookmarks filter, results with thumbnail, snippet, note editor, delete; the current page's note editor on Ctrl/Cmd+D or `/note`
- UI: `ui/RecallView.tsx` – mounted in the workspace (`App.tsx`) and, while open, takes the page area's place (the page view shrinks to nothing): request field, `ui/SketchPad.tsx`, Words / Pictures switch, the cloud (`shared/cloud-layout.ts`), a keyword's pages; opened by `/recall <request>` or File → Recall from History… (Ctrl/Cmd+Shift+Y)
- IPC: `history:suggest|search|screenshot|current|set-note|delete|clear|settings|update-settings|request-open|recall|cancel-recall|request-recall` (UI → main); `history:open`, `history:open-recall`, `history:pages-changed`, `history:settings-changed` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – listens to navigation's `onPageEvent` for the active tab only (switching tabs starts a back/forward visit of the shown page), exports `onHistoryCleared()` (stacks), tracks activity (window focus/visibility, `powerMonitor` idle and lock), reads metadata with an isolated-world script, captures and summarises at high dwell; File → Note This Page… (Ctrl/Cmd+D). `main/db.ts` schema and queries, `main/recorder.ts` visits and dwell, `main/summarize.ts`, `main/semantic.ts`, `main/recall.ts` (prompt, answer parsing, keyword weights)
- Shared: `shared/canonical-url.ts`, `shared/fts-query.ts`, `shared/page-meta.ts` (the page script)

## Invariants
- One page per canonical URL: no tracking parameters, credentials, default ports or anchors; sorted query; hash routes kept; rel=canonical only for the same path – `shared/canonical-url.test.ts`
- Single-page app URL changes become visits only after user input and 3 s without change; at most 60 per origin in 5 min – `main/recorder.test.ts`, `e2e/history.spec.ts`
- Only the active tab is recorded; a tab switch is a back/forward visit – `main.test.ts › records only the active tab…`
- Dwell counts only while the window is focused and shown and the user isn't idle; reloads continue a visit – `main/recorder.test.ts`
- Screenshots and summaries exist only for pages with a visit of ≥ 30 s active time (CHECK constraints) and never for pages with password or card fields – `main/db.test.ts`, `main.test.ts`
- Summaries only with `/history-summaries on`; page content goes to the model as untrusted – `main.test.ts`, `main/summarize.test.ts`
- URL suggestions are index range scans; FTS input can't carry FTS syntax – `main/db.test.ts › uses the bare and domain indexes…`, `shared/fts-query.test.ts`
- Semantic search keeps only known ids and falls back to text search – `main/semantic.test.ts`, `main.test.ts`
- Recall keeps only known ids, clamps scores, normalises keywords and falls back to text matches; screenshots (≤ 16, 320 px) go to the model only with a sketch – `main/recall.test.ts`, `main.test.ts › recalls pages…`, `› falls back…`
- The cloud never overlaps items and is deterministic, heaviest in the middle – `shared/cloud-layout.test.ts`

## Dependencies
- Features: navigation (`onPageEvent`, `getPage`, `getTabs` from `main.ts`), agent (`complete` from `main.ts`); stacks listens to `onHistoryCleared`
- App: `createJsonStore`, `ctx.fileMenu` (ADR 0003)
- Electron: `powerMonitor`, `executeJavaScriptInIsolatedWorld` (world 1002), `capturePage`, `nativeImage` (scaling screenshots for Recall); `node:sqlite` with FTS5
- Stored data: `userData/history.sqlite` (WAL, `secure_delete`; `pages`, `visits`, `pages_fts`), `userData/history-settings.json` (`summaries`)

## Security surface
- IPC: the chrome UI reads history (no visible text; screenshots as `data:image/jpeg` URLs), edits notes, deletes pages, clears history and toggles summaries; every argument is validated.
- Web content: a fixed isolated-world script reads metadata and visible text; nothing is injected into the page's own world. With summaries on, text and a screenshot of high-dwell pages go to the selected model; a Meaning search sends candidate titles, URLs, summaries and notes (ADR 0006); Recall sends the same, plus with a sketch the sketch and up to 16 small screenshots of candidate pages (ADR 0010).

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: ember-ledger-h3x8vq, branching-trail-k4w9zp, drifting-nimbus-r8c3kw · ADRs: 0003, 0006, 0008, 0010
