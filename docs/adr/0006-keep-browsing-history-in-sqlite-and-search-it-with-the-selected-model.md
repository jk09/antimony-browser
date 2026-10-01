# 0006. Keep browsing history in SQLite and search it with the selected model

- Status: Accepted
- Date: 2026-10-01
- Features: history, navigation, agent, prompt
- Spec: ember-ledger-h3x8vq

## Context
History must survive restarts, answer address-bar prefix queries instantly, search page text, and find pages by meaning. It stores sensitive data (what the user read, their notes, screenshots). The architecture already names `node:sqlite` for history. Claude has no embeddings API; Ollama has, but only with an extra embedding model installed. Summaries and semantic search need page content to reach a model without a per-page approval, unlike the assistant's page access (ADR 0004).

## Options considered
1. **`node:sqlite` with FTS5, LLM re-ranking for meaning** – built into Electron's Node (no native module, no new package), FTS5 and indexes cover prefix and full-text search; re-ranking works with whichever model the user already uses, costs one request per Meaning search.
2. **Embeddings (Ollama `/api/embed`) and vector search** – fully local and cheap per query, but needs a second model and does nothing for Claude-only users.
3. **JSON files** (like prompt history) – no indexes or full-text search; doesn't scale to years of history.

## Decision
Option 1. `userData/history.sqlite` (WAL, `secure_delete`) holds pages, visits and an FTS5 index. Screenshots are stored locally for pages with ≥ 30 s active dwell. Summaries are opt-in (`/history-summaries on`, off by default): the selected model gets the page's text and screenshot as untrusted content. A Meaning search sends up to 180 candidates' titles, URLs, descriptions, summaries and notes to the selected model, only when the user picks Meaning. Pages with password or payment-card fields keep no text, screenshot or summary.

## Consequences
- With summaries on, pages the user dwells on are sent to Anthropic (Claude models) or `OLLAMA_HOST` (Ollama) without asking each time; the command says so.
- History is readable by anyone with access to the user's profile directory (like Chromium's own History file); it isn't encrypted at rest.
- A Meaning search costs one model request and only sees candidates (text matches plus the 120 most recent described pages), so old pages without a summary or note can be missed; embeddings could be added later as an `embedding` column.
- `node:sqlite` is still marked experimental in Node; an API change would need a small adapter in `main/db.ts`.
