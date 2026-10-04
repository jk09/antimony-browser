# 0012. Let the assistant search browsing history

- Status: Proposed
- Date: 2026-10-04
- Features: agent, history
- Spec: patient-archive-h6q2wn

## Context
Asked to "search history for …", the assistant could only search the current page: its tools act on the page, and history's Text and Meaning search (ADR 0006) live in the history panel. History holds what the user read and their notes, and a page the assistant reads may carry prompt injection that asks the model to look up history and leak it in a URL. Page tools are gated by page access (ADR 0004); history is a local database, not a live page.

## Options considered
1. **A `search_history` tool behind page access** – reuses the existing gate, but users who keep page access off can't ask about their own history.
2. **A `search_history` tool always offered, counted as reading content** – works without page access; after it, leaving the current site in that run needs approval, as after reading a page, so results can't silently leave in a URL.
3. **Hand the model the whole history or the candidate list** – no extra request, but hundreds of pages per call and no reuse of the panel's ranking.

## Decision
Option 2. History provides its search to the agent (`provideHistorySearch`); the tool runs the panel's Meaning search (default) or Text search and returns at most 20 pages (title, URL, last visit, visit count, note, description or summary, match snippet) inside `<untrusted_page_content>`. A Meaning search still sends up to 180 candidates to the selected model, as in ADR 0006.

## Consequences
- During any run, the model can see titles, URLs and notes of matching history pages, sent to Anthropic, through the CLI, or to Ollama depending on the selected model – also with page access off.
- A history search can make one extra model request per call (re-ranking); a failure falls back to text matches with a notice.
- The agent gains a `history` tool kind; new tools must pick the right kind for gating (`needsPageAccess`).
- If users want history off-limits to the assistant, a setting (e.g. `/history-access off`) would be the follow-up.
