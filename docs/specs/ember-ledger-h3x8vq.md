# Feature Specification: Browsing history with full-text and semantic search

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Browsing history in a local SQLite database, searchable by URL, full text and meaning |
| **Spec ID** | ember-ledger-h3x8vq |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 12:00 +00:00 |
| **Last updated** | 2026-10-01 14:10 +00:00 |
| **Affected features** | history (new), navigation, agent, prompt |
| **Target release** | 0.1.0 |
| **Related links** | docs/architecture.md "Suggested feature order" item 3; ADR 0004, 0005 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Antimony forgets every page as soon as you leave it. The prompt remembers only URLs typed into it, so a page reached by a link, by the assistant or by back/forward can't be found again, and there is no way to find a page by what it said or looked like.
- **Desired outcome:** Every page the user actually visits is recorded once, under a canonical URL, in a per-user SQLite database with its visit times, active dwell time and header metadata. Pages the user spent real time on also get a screenshot and (opt-in) an LLM summary. The user can attach a note to a page, which makes it a bookmark. History is searchable by URL prefix (address-bar suggestions), by full text (SQLite FTS5) and by meaning (the selected LLM ranks candidates).

## 3. Background and Context

- **Current behavior:** `prompt` keeps `userData/prompt-history.json` (typed URLs, queries, commands; 500 entries) for its suggestions. `navigation` publishes URL/title/loading state but stores nothing. `agent` already calls Claude or Ollama through `createMessage` and can capture the page (`capturePage`).
- **Motivation:** History is item 3 of the suggested feature order; `docs/architecture.md` already prescribes `node:sqlite` for it. The assistant makes summaries and semantic search cheap to add.

## 4. Goals

- Goal 1: Record visited pages under a canonical URL, without SPA URL proliferation (one row per page, not per `pushState`).
- Goal 2: Keep time metadata (first/last visit, visit count, active dwell time per visit and in total) and page metadata (title, description, site name, language, author, published time, canonical link, keywords, visible text).
- Goal 3: Store a screenshot and an LLM summary only for pages with high dwell time; both stay `NULL` otherwise.
- Goal 4: User notes per page that double as bookmarks.
- Goal 5: Three kinds of search: indexed URL/host prefix match, FTS5 full-text search, LLM semantic search.

## 5. Non-Goals

- Tabs, private windows (no in-memory history), sync, import from other browsers.
- Embedding vectors / a vector index (no embeddings API for Claude; see 10.6). Semantic search is LLM re-ranking.
- Searching by a query image (reverse image search). "Image search" here means the summary describes what the screenshot shows, so text and semantic search find pages by their look, and results show the screenshot.
- Retention limits / automatic expiry (follow-up); only manual delete and clear.
- Several notes or text highlights per page (one note per page).
- An assistant tool that searches history (follow-up; the agent's tool list stays unchanged).

## 6. User Stories

- As a user, I want URLs I visited (not just typed) suggested in the prompt as I type a host or path prefix.
- As a user, I want to find "that article about SQLite WAL I read last week" by words it contained.
- As a user, I want to ask "the page with the blue pricing table for a vector database" and get it even if I don't remember any of its words.
- As a user, I want to add a note to the current page ("compare with Postgres later") and later list noted pages as my bookmarks.
- As a user, I want to delete a page from history, or clear it all, and know exactly what is sent to a model.

## 7. Functional Requirements

### 7.1 What is recorded
1. A new feature `history` owns `userData/history.sqlite` (per OS user, WAL mode, `secure_delete` on) through `node:sqlite`.
2. A visit is recorded for main-frame navigations of the page view that commit with an http(s) URL and an HTTP status below 400 (`did-navigate`), and for in-page navigations (`did-navigate-in-page`) that pass the SPA rules (7.3).
3. Not recorded: failed loads, error statuses ≥ 400, non-http(s) URLs, the chrome UI, sub-frames, and URLs whose canonical form exceeds 2048 characters.
4. Reloads continue the current visit; back/forward, link clicks, typed URLs and assistant navigations start a new visit. The transition (`typed`, `link`, `back_forward`, `assistant`, `reload`, `in_page`) is stored per visit. `typed` comes from the prompt (`navigation:go`), `assistant` from `PageControls.load`.

### 7.2 Canonical URL
1. Lowercase scheme and host (punycode via WHATWG `URL`), drop default ports, drop credentials, path `''` → `/`.
2. Drop the fragment, except hash routes (`#/…`, `#!…`), which SPAs use as the path.
3. Drop tracking parameters: `utm_*`, `fbclid`, `gclid`, `gclsrc`, `dclid`, `gbraid`, `wbraid`, `msclkid`, `mc_cid`, `mc_eid`, `igshid`, `yclid`, `_ga`, `_gl`, `_hsenc`, `_hsmi`, `mkt_tok`, `oly_anon_id`, `oly_enc_id`, `vero_id`, `ref_src`, `ref_url`, `spm`, `si` (only on youtube.com / youtu.be / spotify.com), `s`/`t` (only on twitter.com / x.com).
4. Sort the remaining query parameters by name (stable for repeated names); drop an empty `?`.
5. Keep path case and trailing slashes (servers may treat them differently).
6. A page's `<link rel="canonical">` replaces the canonical URL only when it is http(s), same origin, has the same path, and differs only in query or fragment (e.g. strips a session id); otherwise it's stored as metadata only. When it applies, the visit moves to that page row.
7. A `bare` key is derived for prefix matching: canonical URL without scheme and leading `www.` (`example.com/docs?a=1`).

### 7.3 SPA navigation
1. Fragment-only changes that canonicalise to the same URL are ignored.
2. Other in-page navigations become a visit only after the URL stays current for 3 s (settle time); a URL replaced sooner (search-as-you-type `?q=`, infinite-scroll `?page=`, map coordinates, carousels) is dropped and its time goes to the previous visit.
3. More than 20 in-page visits per origin within 60 s: further ones are dropped until the rate falls (runaway `pushState`).

### 7.4 Time metadata
1. Per page: `first_visit_at`, `last_visit_at`, `visit_count`, `typed_count`, `dwell_ms` (sum), `max_dwell_ms` (longest single visit).
2. Per visit (`visits` table): `started_at`, `dwell_ms`, `transition`, `referrer_page_id`.
3. Dwell time counts only while the page is the current one, the window is focused and not minimized, and the system idle time is under 60 s (polled every 5 s with `powerMonitor.getSystemIdleTime`). Dwell is flushed to the database at least every 15 s and on navigation and quit.

### 7.5 Page metadata
1. After `did-stop-loading` (+1 s, and again at the high-dwell threshold), a fixed isolated-world script reads: `<title>`, meta `description`, `og:title`, `og:description`, `og:site_name`, `og:type`, `og:image` (URL only), `keywords`, `author`, `article:published_time`, `<html lang>`, `<link rel=canonical>`, and visible text (≤ 50 000 chars). From the main-frame response: HTTP status, `Content-Type`, `Content-Language`, `Last-Modified` (`webRequest.onCompleted` on the browsing session, main frame only; headers are only read, never changed).
2. Pages that show a password or payment-card field get metadata but no visible text, screenshot or summary.

### 7.6 Costly data (screenshot, summary)
1. High dwell = a single visit's active dwell ≥ 30 s (`HIGH_DWELL_MS`). Before that, `screenshot` and `summary` stay `NULL`.
2. On crossing the threshold the page view is captured: JPEG, max 800 px wide, quality 70 (≈ 30–80 KB), stored as a BLOB with `screenshot_at`. Re-captured on a later high-dwell visit if older than 7 days.
3. Summaries are opt-in: `/history-summaries on|off` (default off), stored in `userData/history-settings.json`. When on and a page crosses the threshold, one model request (the model selected in the prompt, Claude or Ollama) gets title, URL, metadata, visible text (≤ 12 000 chars, inside `<untrusted_page_content>`) and the screenshot, and returns a ≤ 120-word summary plus a one-sentence visual description. Stored with `summary_model` and `summarized_at`. Re-summarised if the text changed and the summary is older than 7 days. One summary request at a time; failures are logged and retried on the next high-dwell visit. Claude without a key: skipped silently.

### 7.7 Notes (bookmarks)
1. One note per page (≤ 4000 chars), with `note_updated_at`. A page with a note is a bookmark; clearing the note removes the bookmark.
2. A noted page is never pruned by clear-all unless the user confirms (`/history-clear all` vs `/history-clear`, which keeps noted pages and their notes but drops their visits, text, screenshot and summary).
3. File → Note This Page… (Ctrl/Cmd+D) opens the history panel's note editor for the current page; `/note <text>` sets it directly, `/note` alone opens the editor, `/note clear` removes it.

### 7.8 Search
1. **URL match** (`history.suggest(text)`): prefix on `bare` and on `host` (index range scan, no `LIKE '%…'`), ranked by frecency `visit_count + 2·typed_count` decayed by age, up to 8. The prompt merges these into its URL suggestions (title as label, URL as detail), after its own typed-URL entries, de-duplicated.
2. **Full text** (`history.search({ query, mode: 'text' })`): FTS5 over title, URL tokens, description, keywords, visible text, summary and note (`unicode61 remove_diacritics 2`), ranked by `bm25` with weights title 10, note 8, summary 5, description 4, url 3, text 1, then recency. User input is turned into quoted prefix terms (no FTS syntax injection). `snippet()` returns a highlighted excerpt. Filters: `bookmarked` (has a note).
3. **Semantic** (`mode: 'semantic'`): candidates = FTS matches of any query term (OR, ≤ 60) + the 120 most recent pages with a summary or note; one request to the selected model with each candidate's id, title, URL, last visit date, description, summary and note; the model returns up to 20 ids ordered by relevance as JSON; unknown ids are dropped. Falls back to text results, with a message, when no model is usable.
4. Results: id, URL, title, last visit, visit count, dwell, note, summary, snippet, and a screenshot thumbnail (data URL, fetched per result on demand, `history.screenshot(id)`).

### 7.9 UI
1. `/history [query]` opens a **History** view in the assistant panel's body (replacing the conversation until closed): a search field, a Text / Meaning toggle, a Bookmarks filter, and the results list (thumbnail, title, URL, last visit, dwell, note, snippet or summary). Click opens the page; per row: edit note, delete. Esc or × closes it.
2. The note editor (for the current page) sits at the top of the History view when opened via Ctrl/Cmd+D or `/note`.
3. `/history-clear [all]` and `/history-summaries on|off` are prompt commands.

## 8. Non-Functional Requirements

- Performance: recording runs off the critical path (synchronous `node:sqlite` writes are small; text and BLOB writes happen at most twice per visit). URL suggestions < 5 ms for 100 000 pages (index range scans). FTS queries limited to 50 results.
- Storage: text ≤ 50 KB per page, screenshot ≤ ~80 KB, only for high-dwell pages.
- Security: all IPC arguments validated (lengths, ids are positive integers, enums). The page view keeps no preload; metadata is read with a fixed isolated-world script (as the agent does). The UI never gets raw BLOBs except as `data:image/jpeg` URLs, which the chrome UI CSP must allow for `img-src` (already allowed for attachments; verify). Model output is parsed as data only.
- Privacy: summaries are opt-in and say where content goes (Anthropic or Ollama host); semantic search sends candidate titles, URLs, summaries and notes to the selected model only when the user picks "Meaning". `/history-clear` uses `secure_delete` and `VACUUM`. Pages with sensitive fields get no text, screenshot or summary.
- Platforms: Windows, macOS, Linux (Electron's Node ships `node:sqlite` with FTS5).

## 9. UX / UI Notes

- The History view reuses the panel's styles; results are a list, thumbnails 96×60 on the left, lazy-loaded when scrolled into view.
- Suggestions from history show the page title as label and the bare URL as detail, with the 🌐 icon.

## 10. Technical Notes

1. `src/features/history/` slice: `ipc.ts`, `main.ts` (`register`, `recordNavigation` hook-up), `preload.ts`, `main/db.ts` (schema, migrations via `PRAGMA user_version`, queries), `main/recorder.ts` (visit + dwell state machine with injected clock), `main/summarize.ts`, `main/semantic.ts`, `shared/canonical-url.ts`, `shared/fts-query.ts`, `shared/page-meta.ts` (isolated-world script), `ui/HistoryView.tsx`.
2. `navigation` exports an `onPageEvent` subscription from `main.ts` (navigations with transition, in-page navigations, load stop) so history doesn't attach its own listeners to navigation's WebContents in ways that drift; `navigation:go` marks the next navigation as typed.
3. `agent` exports `complete(request)` from `main.ts`: one model call with the selected model and key, no tools, no conversation, no approval (text-only output), for summaries and semantic ranking; it reuses `createMessage`.
4. Schema (v1):
   - `pages(id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, bare TEXT NOT NULL, host TEXT NOT NULL, title, description, site_name, og_type, image_url, keywords, author, published_at, lang, content_type, content_language, last_modified, http_status, canonical_link, text, text_hash, sensitive INTEGER, first_visit_at, last_visit_at, visit_count, typed_count, dwell_ms, max_dwell_ms, summary, visual_description, summary_model, summarized_at, screenshot BLOB, screenshot_at, note, note_updated_at)`; indexes on `bare`, `host`, `last_visit_at`, partial index on `note_updated_at WHERE note IS NOT NULL`.
   - `visits(id INTEGER PRIMARY KEY, page_id REFERENCES pages ON DELETE CASCADE, started_at, dwell_ms, transition, referrer_page_id)`; index on `(page_id, started_at)` and `started_at`.
   - `pages_fts` FTS5, external content `pages`, kept in sync by triggers on insert/update/delete of the indexed columns.
5. CHECK constraints enforce "costly data only for high dwell": `screenshot IS NULL OR max_dwell_ms >= 30000`, same for `summary`.
6. Semantic search uses LLM re-ranking, not embeddings: Claude has no embeddings API and Ollama embedding models would be a second setup step; re-ranking works with whatever model the user already selected. A later spec can add an `embedding BLOB` column.
7. ADR 0006 records: browsing data in SQLite under userData; page text and screenshots sent to the selected model for summaries (opt-in) and for semantic search (per search).

## 11. Acceptance Criteria

- [x] Canonical URL rules 7.2.1–7.2.5 and 7.2.7 hold (unit: `shared/canonical-url.test.ts`, incl. tracking params, hash routes, ports, IDN, credentials, param order, repeated params).
- [x] rel=canonical is adopted only under 7.2.6 (unit: `canonical-url.test.ts`).
- [x] SPA rules: fragment changes ignored, URLs replaced within 3 s dropped, rate limit (unit: `main/recorder.test.ts` with a fake clock).
- [x] Reload continues a visit; back/forward, link, typed and assistant start one with the right transition (unit: `recorder.test.ts`).
- [x] Dwell counts only while focused, not minimized and not idle (unit: `recorder.test.ts`).
- [x] Screenshot and summary stay NULL below the threshold, are set above it; the DB rejects them otherwise (unit: `main/db.test.ts`, `recorder.test.ts`).
- [x] Summaries only when enabled; content wrapped as untrusted; no request for sensitive pages (unit: `main/summarize.test.ts`).
- [x] URL suggestions use index range scans (unit: `db.test.ts` checks `EXPLAIN QUERY PLAN` uses the indexes) and rank by frecency.
- [x] FTS search finds pages by title, text, summary and note, with snippets; FTS syntax in input is neutralised (unit: `db.test.ts`, `shared/fts-query.test.ts`).
- [x] Semantic search sends candidates, keeps only known ids in the model's order, falls back to text (unit: `main/semantic.test.ts`).
- [x] Notes set/clear, bookmarks filter, `/history-clear` keeps noted pages, `all` removes everything (unit: `db.test.ts`, `main.test.ts`).
- [x] IPC validation rejects bad arguments (unit: `main.test.ts`).
- [x] The prompt shows visited pages from history as URL suggestions (unit: `Prompt.test.tsx`).
- [x] History view: search, mode toggle, open, edit note, delete (unit: `ui/HistoryView.test.tsx`).
- [x] e2e: visiting two local pages records them; `/history` lists them; a note makes one show under Bookmarks (`e2e/history.spec.ts`; CI).

## 12. Testing / Verification

- Unit (Vitest, Node's `node:sqlite` with an in-memory DB, electron mocked), UI (Testing Library + fake API), e2e (Playwright in CI).
- Manual: browse a few sites incl. an SPA (e.g. a docs site with client routing), stay 30 s on one, `/history-summaries on`, Ctrl+D a note, `/history sqlite`, Meaning search.

## 13. Rollout / Follow-up

- Ships enabled, no flag; summaries off by default.
- Follow-ups: retention/expiry, history search tool for the assistant, embeddings, history in a tab page once tabs exist, import.

## 14. Changes during implementation

- **SPA rule 7.3.3 replaced.** With a 3 s settle time at most 20 in-page visits fit in 60 s, so "20 per 60 s" could never trigger. Instead an in-page URL change counts only if the user clicked, tapped or pressed a key in the page (or went back/forward) within the previous 10 s – scrolling doesn't count, so infinite scroll, carousels and timer-driven URLs are ignored – and a safety limit of 60 in-page visits per origin per 5 min remains. `navigation` reports `sinceInputMs` with each in-page navigation (from `webContents` `input-event`).
- **Metadata is read right at `did-stop-loading`** (and when an in-page visit commits, and again at high dwell), not 1 s later: a page left within a second otherwise got no text (seen in e2e).
- **HTTP headers:** no `webRequest.onCompleted` hook (Electron allows one listener per session event, which would block other features). The status comes from `did-navigate`; content type from `document.contentType`, Last-Modified from `document.lastModified` (only when the server sent it), content language from `<meta http-equiv="content-language">`.
- **Schema additions:** `domain` (registrable domain, approximated, so `wikipedia` matches `en.wikipedia.org`), `meta_at`, `summary_text_hash` (for the re-summarise rule), `visual_description` as its own FTS column; `text` and `screenshot` are the last columns so scans don't walk their overflow pages.
- **IPC:** the main → UI change event is `history:pages-changed` (naming rule `<feature>:<noun>-changed`).
- **agent:** `buildRequest` omits `tools` when a request has none (`complete`); the assistant's own requests always have tools, so its prompt cache is unaffected.
- **CSP:** `img-src 'self' data:` already allowed the thumbnails; unchanged.
- **e2e ran in this session** under `xvfb-run` (Electron binary downloaded with curl): all 11 tests pass, including `e2e/history.spec.ts`.
- **ADR 0006** accepted by the owner.
