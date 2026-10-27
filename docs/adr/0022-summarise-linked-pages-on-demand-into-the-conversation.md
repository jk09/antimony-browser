# 0022. Summarise linked pages on demand, into the conversation

- Status: Proposed
- Date: 2026-10-27
- Features: link-summaries, agent, skills
- Spec: linked-digest-r5m2kw

## Context
ADR 0021 marked links and drew summary tooltips inside every simple page, prefetching its links on every load. Changing the page's DOM interfered with pages' own behaviour (Wikipedia's link previews), and fetching links the user never asked about cost model requests and told sites about visits that never happened. The reader still wants to learn what a page's links are about without opening each one.

## Options considered
1. **Keep the tooltips, add per-site exclusions** – stays automatic, but every site with its own link behaviour needs an exception, and the page is still changed.
2. **A built-in skill whose result goes to the conversation** – nothing runs without the command and the page is only read; the summaries sit in the assistant panel instead of next to each link.
3. **A tool the assistant may call when asked in plain words** – flexible, but the model would decide when to fetch other sites, and its answer would paraphrase the summaries.

## Decision
Option 2. `/link-summaries` replays one skill-only agent tool, `summarize_links`: it is never offered to the model, refused if the model names it, and can't be a macro step. Being a page-reading tool (`kind: 'read'`), it needs page access but no approval, as the user typed it. A fixed read-only script in isolated world 1003 collects up to 20 main-text links. Main fetches them with `GET` and `credentials: 'omit'` on `session.fromPartition('link-summaries', { cache: false })`: in memory, nothing shared with `persist:browsing`, HTML only, ≤ 1 MB, ≤ 4 at once. Their extracted gist (≤ 1,500 characters each, marked untrusted) goes to the selected model in one request. The result is a `links` conversation item whose links load in the page view. This supersedes ADR 0021.

## Consequences
- Web pages are never modified; fetching happens only on the user's command and can't act as the user. Linked sites still see a cookieless request from the user's address.
- The summaries live in the conversation (cleared with `/new`) rather than next to each link; nothing is stored.
- `skillOnly` tools are a new agent concept: skills can now run tools the model can't, so each one needs this kind of review.
- Pages behind logins and pages that render their text with JavaScript get no or poor summaries; fetching with cookies or rendering would need a new ADR.
