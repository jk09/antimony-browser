# Feature Specification: Import Edge browsing data into history and stacks

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Import the file Edge's "Export browsing data" creates into Antimony's history, grouping related pages into stacks – from the welcome page and from a deterministic `/import-edge` skill |
| **Spec ID** | gentle-ferry-m3x7bq |
| **Status** | Draft <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-10 09:00 +00:00 |
| **Last updated** | 2026-10-10 09:00 +00:00 |
| **Affected features** | import, agent, history, stacks, skills, welcome |
| **Target release** | 0.1.0 |
| **Related links** | specs first-light-w5k8rd (welcome), spoken-macro-m4q7zt (skills), ember-ledger-h3x8vq (history); ADRs 0006, 0008, 0013 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Someone switching from Edge starts with an empty history and no stacks. The browsing data Edge can export (a CSV file) cannot be brought in.
- **Desired outcome:** The user picks the exported file on the welcome page (or types `/import-edge <file>`); its pages land in history (searchable, in Recall and the map) and the pages visited together form stacks, so earlier research sessions can be reopened with `@name`.

## 3. Background and Context

- **Current behavior:** History records only pages visited in Antimony (`history/main/recorder.ts`). Stacks record only live navigation (`stacks/shared/tree.ts`). Built-in skills are one-step replays of replayable agent tools (`skills/shared/builtins.ts`); the welcome page has six steps.
- **Motivation:** A browser nobody can bring their past into is hard to adopt; stacks are Antimony's unit of "what I was doing".
- **Related issues or references:** `history/main/db.ts`, `stacks/main.ts`, `agent/main/tools.ts` (`replayable`, `checkStep`).

## 4. Goals

- Parse the CSV that Edge's "Export browsing data" produces, tolerant of column names, order, quoting, BOM and date formats.
- Write every imported visit into history (once per canonical URL, with the first/last visit times and visit count).
- Group visits into stacks by browsing session: consecutive visits less than 30 minutes apart form one stack, ordered in time as a chain, so a session's related pages share a stack.
- Offer it as a step on the welcome page (choose a file, see the result) and as the deterministic built-in skill `/import-edge <file>` that makes no model request.

## 5. Non-Goals

- Importing passwords, cookies, bookmarks, extensions, autofill or settings, or any other browser's format (the parser is a module, so another format can be added later).
- Reading Edge's profile directory or database directly; only an exported file the user names.
- Copying screenshots, page text or summaries (none are in the export); imported pages have none until revisited.
- Grouping by topic with the model; grouping is deterministic (time).
- Undo of an import beyond the existing `/history-clear` and closing stacks.

## 6. User Stories

- As a new user, I want to pick my Edge export on the welcome page so that my history is there from the first day.
- As a user, I want `/import-edge ~/Downloads/edge.csv` so that I can import later, or again after a newer export, without the model.
- As a user, I want pages I researched together to be in one stack so that I can reopen that research with `@name`.

## 7. Functional Requirements

1. **Parsing** (`import/shared/edge-csv.ts`, pure): RFC 4180 CSV (quoted fields, `""`, embedded newlines, CRLF/LF, UTF-8 BOM, comma or semicolon). The header row is mandatory; columns are found case-insensitively by name – URL (`url`, `address`, `link`), title (`title`, `name`, `page title`), visit time (`visit time`, `last visit time`, `visited`, `date`, `time`, `timestamp`), optional visit count (`visit count`, `visits`) and optional referrer/transition are ignored if missing. A file without URL and time columns is rejected with an error naming what was found. Times accept ISO 8601 / RFC 2822 / `YYYY-MM-DD HH:MM[:SS]` (UTC when no offset), epoch seconds, epoch milliseconds and WebKit microseconds (since 1601); rows with an unreadable URL or time are skipped and counted. Only `http:` and `https:` URLs are imported; `edge://`, `file:`, `data:`, `javascript:` and others are skipped and counted. Up to 200 000 rows and 50 MB.
2. **History**: each row becomes a visit in history through `importVisits(rows)` exported from `history/main.ts` (stacks and import never touch the database): the page is created or updated by canonical URL (existing pages keep all their data; `first_visit_at` = min, `last_visit_at` = max, `visit_count` += visits imported), titles fill empty titles only, a row already imported (same canonical URL and time) is not added twice, so importing the same file twice changes nothing. Imported visits have transition `import`, no dwell time, and count nothing for typed counts.
3. **Sessions → stacks**: rows are sorted by time and split into sessions where the gap to the previous visit is more than 30 minutes. Each session with at least 2 distinct pages becomes one stack, a chain root → … in time order (repeat visits of a page in a session reuse its node, as live navigation does); a single-page session is only history (no stack). Stack names follow the existing rule (slug of the root title, else host, unique). Imported stacks are added through `importStacks(sessions)` exported from `stacks/main.ts`; they start closed to live tabs (a tab is created when the stack is switched to, as after a restart), are last used at their session's last visit (so they sort behind the user's own stacks), and never replace or become the current stack. The existing limits apply: the 50 most recent sessions become stacks, 500 nodes each (older stacks and pages stay in history).
4. **Result**: `{ rows, visitsImported, pagesCreated, pagesUpdated, duplicates, skipped: { invalid, unsupported }, stacksCreated, stacksSkipped }` shown by the welcome step and returned to the skill as text (`Imported 1 204 visits (310 new pages) into history and 18 stacks; skipped 12 rows.`).
5. **Agent tool** `import_browsing_data` (`kind: 'import'`, `replayable: true`), input `{ path: string }` (absolute path, `~/` expanded, existing readable regular file, `.csv`, ≤ 50 MB). It needs no page access and no model. Because it reads a local file the model chose, the assistant may call it only when the user asked for an import in the same request; every run asks the user's approval (a native dialog naming the file) unless it replays the built-in skill typed by the user (a user-typed `/import-edge <file>` is the user's own request). The model-facing tool description states this.
6. **Deterministic skill**: built-in skill `import-edge` with parameter `file` (hint `path to the Edge export (.csv)`), one step `import_browsing_data` with `path: "{{file}}"`; listed in `/config` under built-in skills. The last parameter takes the rest of the line, so paths with spaces work. Missing argument runs nothing (existing rule).
7. **Welcome step**: a new "Import" step after Theme and before Prompt: "Bring your history from Edge". It explains how to export (Edge → Settings → Profiles → *Export browsing data*), has *Choose file…* (native open dialog filtered to `.csv`, opened by main), shows a progress state and then the result or the error, and can be skipped (Next). It never runs on its own. There is no menu item; the entry points are the welcome step and `/import-edge`.
8. **IPC** (feature `import`): `import:choose` (UI → main; opens the dialog, returns the chosen path or null), `import:run` (UI → main; `{ path }` → `ImportResult`, runs the same function as the skill). Both validate arguments; there is no way to pass file contents over IPC.
9. **Progress/cancel**: parsing and writing run in chunks of 2 000 rows so the main process stays responsive; the whole history write is one transaction (all or nothing); stacks are saved once at the end. Importing while another import runs is rejected (`An import is already running.`).

## 8. Non-Functional Requirements

- Performance: 100 000 rows import in under 10 s on a typical machine; memory for the file is released after the import.
- Reliability: a failed import writes nothing to history or stacks (transaction); bad rows never abort the run.
- Security: no IPC takes file contents; paths are read only in main after the checks above; imported URLs are filtered to http(s) and titles are stored as plain text (rendered by React, never as HTML); no network request is made; web content gains nothing. The model never sees file contents, only the result line.
- Privacy: nothing leaves the machine; imported data lives in the existing `history.sqlite` and `stacks.json` and is removed by `/history-clear` and by closing stacks. The export is not copied.
- Accessibility: the step uses the welcome page's existing controls, with the result in a live region.
- Platforms: all; the dialog and `~/` expansion use Electron/Node APIs.

## 9. UX / UI Notes

- User flow: Welcome → Import → *Choose file…* → "Importing…" → "Imported 1 204 visits into history and 18 stacks. Skipped 12 rows." → Next. Or in the prompt: `/import-edge ~/Downloads/Edge browsing data.csv`.
- Visual considerations: matches the other welcome steps.
- Edge cases: empty file; header only; wrong file (e.g. a passwords CSV: rejected, naming the columns found); same file twice (reports `0 new`, duplicates counted); very long titles (clipped to 500 chars); times in the future (clamped to now); non-UTF-8 files (decoded as UTF-8 with replacement).

## 10. Technical Notes

- Proposed approach: new feature folder `src/features/import/` (`ipc.ts`, `main.ts`, `preload.ts`, `shared/edge-csv.ts`, `shared/sessions.ts`, `ui/ImportStep.tsx`); registered in the four places. `main.ts` exports `importBrowsingData(path)` and provides it to the agent with `provideImporter` (same pattern as `provideMacros`); history gains `importVisits`, stacks gains `importStacks`; `skills/shared/builtins.ts` gains the skill; `agent/main/tools.ts` gains the tool; welcome gets an `importStep` slot filled by `App.tsx` with import's `ImportStep` (like the theme picker), so welcome imports no import code.
- Process split: parsing, grouping, history and stacks writes in main; UI only starts and shows the result.
- Dependencies: no npm package (a small CSV reader in `shared/`), so no ADR for a package; an ADR is needed for the new model-reachable file-reading tool (ADR 0017: *import browsing data from a file the user names*, recording the approval rule).
- Risks / unknowns: **the exact columns of Edge's export are unverified here** – the parser is header-driven with aliases and the spec expects to be adjusted (section 14) when the user supplies a real file; large sessions; stack names colliding.
- Open questions: none.

## 11. Acceptance Criteria

- [ ] The CSV parser handles quoting, BOM, CRLF, semicolons, column aliases and all listed time formats, and rejects files without URL/time columns – `import/shared/edge-csv.test.ts`.
- [ ] Non-http(s) and invalid rows are skipped and counted – `edge-csv.test.ts`.
- [ ] Sessions split at a gap over 30 minutes; repeat visits reuse a node; single-page sessions make no stack – `import/shared/sessions.test.ts`.
- [ ] History: pages created/updated by canonical URL, min/max times, visit counts, no duplicate on re-import, existing data kept – `history/main.test.ts`.
- [ ] Stacks: imported stacks are added unopened, named by the usual rule, behind existing ones, never current, limits respected – `stacks/main.test.ts`.
- [ ] `import_browsing_data` validates its path (absolute / `~/`, exists, `.csv`, size) and is replayable; the model-called form asks approval, the user-typed skill doesn't – `agent/main/tools.test.ts`, `agent/main/agent.test.ts`.
- [ ] Built-in skill `/import-edge` runs the tool with the typed path (spaces kept) and is listed in `/config` – `skills/main.test.ts`, `skills/ui/ConfigView.test.tsx`.
- [ ] The welcome Import step chooses a file, shows progress, the result or the error, and can be skipped – `welcome/ui/WelcomeView.test.tsx`, `import/ui/ImportStep.test.tsx`.
- [ ] An import is all-or-nothing and one at a time – `import/main.test.ts`.
- [ ] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: export from Edge (Settings → Profiles → Export browsing data), run the welcome step and `/import-edge`; check `/history` search finds old pages, `@` lists imported stacks, opening one loads its pages; import again → no duplicates.
- Automated test coverage: unit tests above; an e2e test for `/import-edge` with a generated CSV in `e2e/` (runs in CI; the Electron binary isn't available in cloud sessions).
- Regression considerations: welcome step count and the e2e that walks it, history FTS triggers on bulk insert, `stacks.json` size, `/config` built-in list.

## 13. Rollout / Follow-up

- Rollout plan: no flag.
- Follow-up work: Chrome/Firefox formats, importing bookmarks as notes, grouping a long session by topic.

## 14. Changes during implementation

None yet.
