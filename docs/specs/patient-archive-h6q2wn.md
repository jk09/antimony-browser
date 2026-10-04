# Feature Specification: Let the assistant search browsing history

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | The assistant gets a `search_history` tool that finds pages in the user's browsing history by meaning (or by text), so requests like "search history for any mention of LLM" work from the prompt |
| **Spec ID** | patient-archive-h6q2wn |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-04 18:30 +00:00 |
| **Last updated** | 2026-10-04 19:30 +00:00 |
| **Affected features** | agent, history |
| **Target release** | 0.1.0 |
| **Related links** | specs ember-ledger-h3x8vq (history, Meaning search), violet-harbinger-p7w3kd (agent); ADRs 0004, 0006, 0012; PR #39 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Asked to "search history for any mention of LLM", the assistant answers that it has no tool for it and searches the current page instead. History's Meaning search exists only in the history panel.
- **Desired outcome:** The assistant can search the user's history itself – by meaning by default, by text when asked for exact words – and answer with the matching pages (title, address, when visited, why it matches), then open one if the user wants.

## 3. Background and Context

- **Current behavior:** The agent's tools act on the current page only (`navigate`, `read_page`, `find_in_page`, …). History (`src/features/history`) offers Text and Meaning search over IPC to its own panel; Meaning search re-ranks candidates with the selected model (`complete`, ADR 0006).
- **Motivation:** History is the browser's memory; the prompt is where the user asks for things. Saying "open history and search there" is a dead end.
- **Related issues or references:** `history/main.ts › semanticSearch`, `agent/main/tools.ts`.

## 4. Goals

- One assistant tool that runs history's existing Text or Meaning search and returns the results to the model.
- Available without page access (it reads the local history database, not the page), but history data is untrusted and, like reading a page, makes cross-site navigation in the same run ask for approval.

## 5. Non-Goals

- Embeddings or a new search algorithm (Meaning search stays LLM re-ranking, ADR 0006).
- Letting the assistant edit, delete or clear history, write notes, or open Recall.
- Searching another browser's history, or chrome://history.
- Skills replaying a history search (the tool only informs the model).

## 6. User Stories

- As a user, I want to type "search history for any mention of LLM" and get the pages I visited about LLMs, so that I don't have to open the history panel.
- As a user, I want to say "open that article about sourdough I read last week" and have the assistant find it in history and open it.

## 7. Functional Requirements

1. New agent tool `search_history` (new `kind: 'history'`, not replayable) with input `{ query: string, mode?: 'meaning' | 'text', bookmarked?: boolean }`; `mode` defaults to `meaning`, `bookmarked` (only pages with a note) to false. `query` is 1–500 characters after trimming.
2. The tool runs history's search: `meaning` = the Meaning search of the history panel (text candidates + recently described pages re-ranked by the selected model, falling back to text matches with a notice); `text` = full-text search. Results are the same pages the panel would show, at most 20.
3. The result lists each page on one line: title, URL, last visit date, visit count, and when present the note, the description or summary (clipped) and the text-match snippet; plus the search's notice if it fell back. All page data is inside `<untrusted_page_content>`. No match → `No pages in history match.`
4. It is offered and runs with page access on or off and without a page loaded, and sets the run's "read content" flag, so a later navigation to another site in that run waits for approval.
5. History provides the search to the agent through a function exported from `agent/main.ts` (`provideHistorySearch`), called in history's `register`; the agent doesn't import history. Without a provider the tool fails with `Browsing history is not available.`
6. The conversation shows `Search history for "<query>"` (with `by text` / `in bookmarks` when set); the debug panel logs it like other tools.
7. The system prompt mentions the tool, so the model uses it for questions about pages the user visited before.

## 8. Non-Functional Requirements

- Performance: one extra model request per Meaning search (as in the panel), 60 s timeout; Stop aborts the wait.
- Reliability: a failed re-ranking falls back to text matches with a notice, as in the panel.
- Security: no new IPC channel; web content gains nothing. History text is untrusted input to the model; reading it counts as reading page content (ADR 0004 cross-site rule).
- Privacy: during any run (page access on or off), the model sees titles, URLs, dates, descriptions, summaries, snippets and notes of up to 20 matching pages, and a Meaning search sends up to 180 candidates to the selected model (as ADR 0006). New ADR 0012 records this. Nothing new is stored.
- Accessibility: no new UI.
- Platforms: all.

## 9. UX / UI Notes

- User flow: "search history for any mention of LLM" → tool row `Search history for "LLM"` → answer listing the pages; "open the second one" → `navigate`.
- Visual considerations: none beyond the existing tool row.
- Edge cases: empty history; query only whitespace (rejected); no model usable for re-ranking (text fallback with notice).

## 10. Technical Notes

- Proposed approach: history refactors its search into one `search(query, mode, bookmarked)` used by both IPC and the provider. Agent: tool definition and formatting in `main/tools.ts`; `executeTool` gets an optional `HistoryPort`; `callTool` stops requiring a browser for `search_history`.
- Process split: main only.
- Dependencies: history → agent (`provideHistorySearch`, alongside the existing `complete`). No npm package.
- Risks / unknowns: changing `SYSTEM_PROMPT` and the tool list invalidates the prompt cache once.
- Open questions: none.

## 11. Acceptance Criteria

- [x] `search_history` validates its input (mode enum, booleans, empty / too-long query) – `agent/main/tools.test.ts`.
- [x] It returns formatted, untrusted results and the fallback notice, and fails cleanly without a provider – `agent/main/tools.test.ts`.
- [x] It works without page access and without a loaded page, and makes a later cross-site `navigate` ask for approval – `agent/main/agent.test.ts`.
- [x] History provides its Text and Meaning search to the agent (Meaning re-ranks with `complete`, falls back to text) – `history/main.test.ts`.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: visit a few pages about LLMs, ask (page access on or off) "search history for any mention of LLM" → pages listed; "open the first one" → opens it.
- Automated test coverage: unit tests above; no new e2e.
- Regression considerations: history panel search, existing tools, CLI models (tool list over MCP).

## 13. Rollout / Follow-up

- Rollout plan: no flag.
- Follow-up work: a visit-date filter (`since` / `until`); letting the assistant open Recall.

## 14. Changes during implementation

- Gating changed on review: `search_history` doesn't need page access (new tool kind `history`, `needsPageAccess` helper) but still counts as reading content for the cross-site navigation rule.
- `npm run test:e2e` not run in the cloud session (no Electron binary); CI runs it.
