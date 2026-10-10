# Feature Specification: Group imported pages by URL and topic; choose the import file in a dialog

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Imported Edge pages are assigned to a manageable number of stacks by how related their URLs are, refined by topic with the assistant; `/import-edge` without a path opens a system file dialog |
| **Spec ID** | tidy-compass-k7r2vb |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-10 12:00 +00:00 |
| **Last updated** | 2026-10-10 14:00 +00:00 |
| **Affected features** | import, stacks, skills, agent, welcome |
| **Target release** | 0.1.0 |
| **Related links** | spec gentle-ferry-m3x7bq (the import); ADRs 0017 (superseded in part by 0018), 0009, 0015; PR #69 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The import makes one stack per 30-minute browsing session. A real export has thousands of visits, so it would create dozens of tiny stacks (50 at most, newest only), and pages about the same thing end up in different stacks. `/import-edge` also needs the path typed.
- **Desired outcome:** Related pages share a stack – by address first (site, then path), then by topic when the assistant can tell – and an import creates at most 30 stacks. `/import-edge` with no argument opens the system file dialog.

## 3. Background and Context

- **Current behavior:** `import/shared/sessions.ts` splits visits at gaps over 30 minutes; `stacks/shared/imported.ts` turns each session into a chain stack; `stacks.importStacks` skips sessions already imported by start time. The skill's parameter `file` is required; `import_browsing_data` requires `path`.
- **Motivation:** Stacks are "what I was doing about X", not "what I did at 9:10". Time sessions fragment a topic and flood the stack list.
- **Related issues or references:** `import/main/run.ts`, `skills/shared/params.ts` (`bindArgs`), `agent/main/tools.ts`.

## 4. Goals

- Group imported pages deterministically by URL relatedness: registrable domain, and for big domains the first path segment.
- Keep the number of new stacks at most 30; leftovers join the closest group or stay in history only.
- When the Claude CLI works, refine the grouping by meaning in one model request: merge groups about the same topic, place leftover pages, name the stacks. Fall back silently to the URL grouping when it doesn't.
- `/import-edge` without an argument opens a native file dialog; with a path it works as before.

## 5. Non-Goals

- Re-grouping pages already in history or stacks; only an import's pages.
- Embeddings or a new package (the model call is the existing `complete`, ADR 0009/0015).
- Choosing the number of stacks (fixed 30), or a setting to turn topic grouping off (see section 8, Privacy: URL-only is what happens when the CLI is unavailable).
- Grouping by time; the 30-minute sessions are removed.

## 6. User Stories

- As a user, I want my 3 000 Edge pages in a few dozen stacks – one for GitHub, one for a trip I planned, one for a sourdough hobby – so that the stack list stays usable.
- As a user, I want to type `/import-edge` and pick the file in a dialog so that I don't have to find and type a path.

## 7. Functional Requirements

1. **Pages**: rows are reduced to pages (address ignoring the fragment), each with its title (first non-empty), first and last visit and visit count. Pages with the same canonical address in several rows count once.
2. **URL grouping** (`import/shared/grouping.ts`, pure): (a) group by registrable domain (`en.wikipedia.org` and `de.wikipedia.org` → `wikipedia.org`); (b) a domain with more than 60 pages is split by first path segment: a segment with at least 3 pages becomes its own group `domain/segment`, the rest stays in the domain's group; (c) groups of at least 2 pages are *clusters*, singletons are *leftovers*; (d) the 30 clusters with most pages (ties: latest visit) are kept, the rest become leftovers.
3. **Leftovers without the model**: a leftover joins the kept cluster it shares the most distinctive words with (title and address words, ≥ 4 letters, not in 20 % of all pages), if at least 2 words are shared; otherwise it stays in history only.
4. **Topic refinement with the model** (`import/main/topics.ts`): after step 2, when a model is usable, one `complete` request (60 s timeout, aborts with the run) sends the clusters (id, domain/segment, page count, up to 5 sample titles) and up to 300 leftover pages (newest first: id, title, host/path). The model answers JSON `{ stacks: [{ name, clusters: [id…], pages: [id…] }] }`: clusters about the same subject are merged, leftovers placed, each stack named (≤ 32 characters). The answer is validated: unknown ids ignored, each id used once, at most 30 stacks, stacks with fewer than 2 pages dropped, unplaced clusters stay as their own stacks. Any error, timeout or invalid answer → the URL grouping (steps 2–3) is used and the result says so.
5. **Stacks**: each group becomes one stack, a chain in first-visit order (500 newest pages at most), named by the model's name or, from URLs, the domain's first label (`github`, `wikipedia`; `github-torvalds` for a split group), unique with `-2`…, last used at its latest visit, unopened, never current (as in gentle-ferry-m3x7bq). `Stack.imported` becomes the import time (any number; older files keep their value). A group is skipped when at least 80 % of its addresses are already in an imported stack, so importing the same file again adds no stacks; room is limited to 50 stacks in all, as before.
6. **Result**: `ImportResult.stacksCreated`/`stacksSkipped` as before, plus `grouping: 'topics' | 'addresses'` and, when topics were wanted but failed, `topicsError`. The one-line result says `grouped by topic` or `grouped by address (the assistant wasn't available)`.
7. **Optional argument**: `SkillParam` gets `optional?: boolean`; `bindArgs` doesn't require optional parameters (value ''), `argumentHint` shows them as `[file: …]`, `signature` as `[file]`; macros can't declare optional parameters (not accepted by `save_macro`). The built-in `import-edge` declares `file` optional.
8. **No path → dialog**: `import_browsing_data`'s `path` becomes optional. With no (or empty) path, import's main opens the native open dialog (`.csv`), as the welcome step does; a cancelled dialog ends the run normally with `No file was chosen.`; the approval row for a model-called import reads `Import browsing data (you choose the file)`.
9. **Welcome step**: the text says pages are grouped by site and topic and that the titles and addresses of up to ~400 pages are sent to the assistant for that, once; the result shows how it was grouped.
10. Removed: `shared/sessions.ts` and its tests, `ImportedSession` (replaced by `ImportedStack`), the session-start dedupe.

## 8. Non-Functional Requirements

- Performance: URL grouping of 200 000 rows in under 2 s; one model request, ≤ ~25 000 characters sent; import never waits more than 60 s for the model.
- Reliability: a model failure never fails the import (history and URL-grouped stacks are written).
- Security: no new IPC channel. The dialog is opened in main. The model's answer is data: ids are checked, names are slugged (letters, digits, `-`), nothing from it is executed or becomes a URL.
- Privacy: **new** – with the Claude CLI available, an import sends the model titles and `host/path` (no query string or fragment) of up to ~330 imported pages (cluster samples and leftovers). Recorded in ADR 0018 (supersedes the grouping part of 0017). The welcome step discloses it before the file is chosen; a typed `/import-edge` is the user's own command and the model-called form is approved. Nothing is stored beyond the stacks.
- Accessibility: unchanged UI.
- Platforms: all; the native dialog is Electron's.

## 9. UX / UI Notes

- User flow: `/import-edge` → dialog → "Imported 3 214 visits (1 905 new pages) into history and 26 stacks, grouped by topic." Or `/import-edge ~/edge.csv` as before.
- Edge cases: one huge domain (split by path segment, newest 500 pages); everything a singleton (no stacks, history only); model names two stacks alike (made unique); cancelled dialog (not an error).

## 10. Technical Notes

- Proposed approach: `shared/grouping.ts` (groups, clusters, leftovers, local placement, `registrableDomain`), `main/topics.ts` (prompt, answer parser, merge into the groups; takes a `complete`-like function), `run.ts` orchestrates (parse → groups → optional topics → history → stacks). `stacks.importStacks(stacks: ImportedStack[])` takes `{ name?: string, pages: {url,title,at}[], lastAt }` and does naming, uniqueness, the 80 % rule and the limit. Agent: `provideImporter` port `run(path?: string)`; `complete` is passed to import by `import/main.ts` (a function exported from `agent/main.ts`, already used by history).
- Process split: main only; UI shows the result.
- Dependencies: import → agent (`complete`, `provideImporter`), history, stacks. No package.
- Risks / unknowns: model quality (hence validation and fallback); a very long title list in the prompt (clipped per title to 100 characters); registrable-domain approximation (shared with history's logic: duplicated in a few lines rather than imported, features may not import each other's `shared/`).
- Open questions: none.

## 11. Acceptance Criteria

- [x] Domain grouping merges subdomains, splits a domain over 60 pages by first path segment, keeps the 30 largest clusters and turns the rest into leftovers – `import/shared/grouping.test.ts`.
- [x] Leftovers join the cluster sharing ≥ 2 distinctive words, else stay out – `grouping.test.ts`.
- [x] The topic answer is validated (unknown/duplicate ids, > 30 stacks, tiny stacks, bad JSON) and merges clusters, places leftovers and names stacks – `import/main/topics.test.ts`.
- [x] A failing or invalid model falls back to the URL grouping and the result says so – `import/main/run.test.ts`.
- [x] Only titles and `host/path` of at most ~330 pages go into the request – `topics.test.ts`.
- [x] `importStacks` builds chain stacks from groups, names them uniquely, skips groups ≥ 80 % already imported, respects the 50-stack room – `stacks/main.test.ts`, `stacks/shared/imported.test.ts`.
- [x] Optional skill parameters: `bindArgs`, `argumentHint`, `signature`; macros can't declare them – `skills/shared/params.test.ts`, `skills/main.test.ts`.
- [x] `/import-edge` with no argument opens the dialog, imports the chosen file, ends quietly on cancel; the tool accepts an empty path – `import/main.test.ts`, `agent/main/tools.test.ts`, `agent/main/agent.test.ts`.
- [x] Welcome step text and result show the grouping – `import/ui/ImportStep.test.tsx`, `welcome/ui/WelcomeView.test.tsx`.
- [x] `npm run check` passes; the e2e `/import-edge` test is updated for the new grouping.

## 12. Testing / Verification

- Manual test plan: import a real Edge export with and without the CLI logged in; check the stack count (≤ 30), that github/wikipedia pages share stacks, and that topic stacks make sense; `/import-edge` with no argument → dialog; cancel → nothing happens; import again → no new stacks.
- Automated test coverage: unit tests above; e2e `/import-edge` with the fake CLI answering the topic request.
- Regression considerations: the welcome e2e walk, `/config` built-in list, `stacks.json` with `imported` numbers from the first version.

## 13. Rollout / Follow-up

- Rollout plan: no flag. ADR 0018 supersedes the grouping part of ADR 0017.
- Follow-up work: grouping of the user's existing history; a setting to keep topic grouping off.

## 14. Changes during implementation

- `ImportPort.run` also takes the run's abort signal, so Stop ends the wait for the model (combined with the 60 s timeout); a stopped run writes nothing.
- The leftover placement runs after the model too, for single pages the model didn't place (and the ones past the 300 sent).
- `bindArgs` now takes the parameter objects, not names; `ImportedSession` became `ImportedStack` (`name`, `lastAt`, `pages`); `Stack.imported` is the import time. Older `stacks.json` values (a session start) still load.
- The fake Claude CLI used by the e2e tests answers the topic request by putting everything in one stack "bread".
- `npm run test:e2e`: the new `/import-edge` test and the welcome walk were run in the cloud session (Electron binary available).
