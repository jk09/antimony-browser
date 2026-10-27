# link-summaries

Lets you learn what a page's links are about without opening them: `/link-summaries` fetches the pages the current page's main text links to (up to 20, without your cookies), has the selected model summarise each in a sentence or two, and lists them in the conversation, where a click opens one. The page itself is only read, never changed.

## Entry points
- UI: – (the list is agent's `links` conversation item; the skill is the built-in `/link-summaries` in skills)
- IPC: – (runs through `skills:run`; the list arrives in `agent:state-changed`)
- Main: `register` in `main.ts` – `provideLinkSummaries` with agent; `summarize` reads the active page (`getPage`), runs `collectLinks` in isolated world 1003, prefetches the targets (`main/prefetch.ts`: GET, `credentials: 'omit'`, ≤ 4 at once, 10 s, 1 MB, HTML only) on the in-memory session `link-summaries`, extracts their gist (`shared/extract.ts`, 1,500 characters), asks agent's `complete` once (`main/summarize.ts`) and returns the links in page order with their summary or null
- Shared: `shared/page-scripts.ts` – `collectLinks` (main content: `article`/`main`/`[role=main]`/body without nav, header, footer and asides; distinct http(s) targets without fragment, not the page itself, no downloads or file extensions, ≤ 20, with link text)

## Invariants
- Only main-text links, deduplicated, ≤ 20; the script doesn't change the page – `shared/page-scripts.test.ts`, `e2e/link-summaries.spec.ts`
- The page script's answer is validated – `main.test.ts › keeps only valid, distinct web links…`
- Prefetching uses a non-`persist:` session of its own, GET without credentials, HTML only, ≤ 1 MB, and sends none of the browsing session's cookies – `main.test.ts › fetches the linked pages cookieless…`, `main/prefetch.test.ts`, `e2e/link-summaries.spec.ts`
- One model request, content marked untrusted; answer lines map to links by number, `-` and missing lines give no summary – `main.test.ts`, `main/summarize.test.ts`
- No page, no links, nothing readable or a failed model request end the run with the reason; Stop aborts the fetches before any model request – `main.test.ts › says why…`, `› stops with the run…`

## Dependencies
- Features: navigation (`getPage` from `main.ts`), agent (`complete`, `provideLinkSummaries` from `main.ts`, `LinkSummary` from `ipc.ts`); skills ships the `/link-summaries` built-in
- Electron: `session.fromPartition('link-summaries', { cache: false })`, `Session.fetch`, `executeJavaScriptInIsolatedWorld` (world 1003)
- Stored data: – (summaries only in the conversation)

## Security surface
- IPC: –
- Web content: a fixed read-only isolated-world script reads the page's links. On `/link-summaries` only (page access on), up to 20 linked addresses are fetched from their sites without cookies or credentials, and their extracted text (not the current page's) goes to the selected model (ADR 0022). The model can't start this: `summarize_links` is skill-only.

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: linked-digest-r5m2kw · ADRs: 0004, 0015, 0021 (superseded), 0022
