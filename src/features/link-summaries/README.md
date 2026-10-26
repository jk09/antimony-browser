# link-summaries

Lets you study a web text without leaving it: with `/link-summaries on` (or File → Link Summaries), the links in the main text of article-like pages are marked with a dotted underline and ⓘ once the selected model has summarised the page they lead to, and hovering or focusing one shows that summary in a tooltip. The linked pages are prefetched in the background without your cookies.

## Entry points
- UI: – (the prompt's `/link-summaries on|off` calls `window.antimony.linkSummaries`; no component of its own)
- IPC: `link-summaries:settings|update-settings` (UI → main), `link-summaries:settings-changed` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – listens to navigation's `onPageEvent` (active tab's `loaded`, `navigated`, `activated`), runs `scanLinks` in isolated world 1003, prefetches the targets not in the cache (`main/prefetch.ts`, ≤ 4 at once, 10 s, 1 MB, HTML only) on the in-memory session `link-summaries`, extracts their gist (`shared/extract.ts`, 1,500 chars), asks agent's `complete` once per page (`main/summarize.ts`), keeps results in an in-memory LRU of 500 (`main/cache.ts`, misses included) and runs `markLinks`; File → Link Summaries checkbox, kept in sync with the setting
- Shared: `shared/page-scripts.ts` – `scanLinks` (simple page: ≥ 1,500 chars of paragraph text in `article`/`main`/`[role=main]`/body, no password or card field, ≤ 300 links; ≤ 20 distinct http(s) targets outside nav/header/footer/aside, no fragment, not the page itself, no downloads or file extensions), `markLinks` (marker stylesheet, tooltip in a closed shadow root: 300 ms hover delay, on focus, hidden on leave, blur, Escape, scroll), `unmarkLinks`

## Invariants
- Off by default; nothing runs while off; switching from IPC or the menu keeps both in sync and persists – `main.test.ts › is off by default…`, `› switches from IPC and the File menu…`
- Only article-like pages and links in their main text get summaries – `shared/page-scripts.test.ts › scanLinks`
- Prefetching uses a non-`persist:` session of its own, `GET` without credentials, and skips non-HTML – `main.test.ts › prefetches cookieless…`, `main/prefetch.test.ts`, `e2e/link-summaries.spec.ts`
- One model request per page, content marked untrusted; known targets aren't fetched or asked again; a failed request caches nothing – `main.test.ts`, `main/summarize.test.ts`
- Results for a page that navigated away are dropped; the page's scan answer is validated – `main.test.ts › drops the results…`, `› ignores a malformed scan answer…`
- The summary text is only in a closed shadow root, never in the page's DOM – `shared/page-scripts.test.ts › marks every link…`, `e2e/link-summaries.spec.ts`
- Turning off removes the marks, stylesheet and tooltip and clears the cache – `main.test.ts › turning off…`, `shared/page-scripts.test.ts › unmarkLinks…`

## Dependencies
- Features: navigation (`getPage`, `getTabs`, `onPageEvent` from `main.ts`), agent (`complete` from `main.ts`); prompt runs `/link-summaries`
- Electron: `session.fromPartition('link-summaries', { cache: false })`, `Session.fetch`, `executeJavaScriptInIsolatedWorld` (world 1003), `Menu.getApplicationMenu` (checkbox state)
- Stored data: `userData/link-summaries.json` (`enabled`); summaries only in memory

## Security surface
- IPC: the chrome UI reads and switches the mode (validated boolean).
- Web content: fixed isolated-world scripts read links and text length and add a `data-antimony-summary` attribute, one `<style>` and one shadow host; the page's own world gets no API and can't read the summaries. Prefetch fetches up to 20 addresses per simple page from their sites, without cookies or credentials; their extracted text (not the page's own) goes to the selected model (ADR 0021).

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: linked-glimpse-t8w3qn · ADRs: 0004, 0015, 0021
