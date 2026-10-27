# Feature Specification: Summarise a page's links on demand

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `/link-summaries` – a built-in skill that fetches the pages the current page's main text links to and shows a short summary of each, as a list of clickable links, in the conversation |
| **Spec ID** | linked-digest-r5m2kw |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-27 09:00 +00:00 |
| **Last updated** | 2026-10-27 11:00 +00:00 |
| **Affected features** | link-summaries (new), agent, skills |
| **Target release** | 0.1.0 |
| **Related links** | PR #100; PR #98 (link tooltips, reverted), ADR 0004 (assistant reads pages), ADR 0013 (macros as tool-call scripts), ADR 0015 (CLI only); ADR 0021 (superseded), new ADR 0022 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** While studying a web text, the reader wants to know what its links are about without opening each one. The first attempt (PR #98) marked links and drew tooltips inside every simple page automatically; changing the page's DOM interfered with pages' own behaviour (Wikipedia's link previews) and it fetched links the user never asked about.
- **Desired outcome:** Typing `/link-summaries` summarises the links of the page you are reading, once, and shows the result in the conversation in the assistant panel – the page itself is never changed.

## 3. Background and Context

- **Current behavior:** No way to learn what a link leads to without following it.
- **Motivation:** A student of web materials wants to learn related specifics without interrupting the study (user request), on demand only.
- **Related issues or references:** built-in skills (`/reload`, `/stop`, `/import-edge`) replay one agent tool without the model; the agent's `complete` sends one request through the user's Claude Code CLI.

## 4. Goals

- Goal 1: `/link-summaries` (a built-in skill, listed on `/skills`) summarises up to 20 links of the current page's main text.
- Goal 2: The summaries appear in the conversation as a list: each entry the link (clickable, opens in the page view) and one or two sentences about the linked page.
- Goal 3: Nothing happens without the command, and the web page is never modified.

## 5. Non-Goals

- Non-goal 1: Automatic summaries, marks or tooltips in the page (PR #98, reverted).
- Non-goal 2: The assistant calling the summariser on its own in a conversation (skill only).
- Non-goal 3: Pages behind a login (fetching never sends the user's cookies), PDFs and other non-HTML targets, links added outside the main text.
- Non-goal 4: Storing summaries (nothing is kept after the run).

## 6. User Stories

- As a student of web materials, I want to type `/link-summaries` on the page I study and get a short summary of each link in the panel, so that I learn related specifics without leaving the text.
- As that student, I want each listed link to be clickable so that I can open the one that looks worth it.
- As a privacy-minded user, I want the fetching to happen only when I ask, without my logins.

## 7. Functional Requirements

1. **Skill.** `/link-summaries` is a built-in skill (no parameters) that replays one step: the agent tool `summarize_links`. Like other skills it shows the command and a tool line ("Summarise the linked pages") in the conversation, makes Stop available, and needs page access (it reads the page; without it the run says "Turn page access on first"). It asks no approval: it is the user's own command and changes nothing on the page.
2. **Skill only.** `summarize_links` is never offered to the model (not in the tools the CLI sees, refused if the model names it) and can't be a macro step.
3. **Links.** A fixed read-only isolated-world script (world 1003) collects, from the main content (`article`, `main`, `[role=main]`, else the body) without `nav`, `header`, `footer`, `aside`, `[role=navigation]`, the distinct http(s) targets of links in document order, without fragment, excluding links to the page itself, `download` links and non-HTML file extensions; at most 20, each with its link text (first occurrence, ≤ 200 characters). No links → the run ends with "No links to summarise in this page's text."
4. **Fetch.** Main fetches each target with `GET`, `credentials: 'omit'`, on a separate in-memory session (`link-summaries`, not `persist:`, no cache), at most 4 at once, 10 s timeout each, reading at most 1 MB and only `text/html` / `application/xhtml+xml` responses; final URLs must be http(s). From the HTML it extracts the title, description and visible text (without scripts, styles, navigation and markup), at most 1,500 characters.
5. **Summarise.** The fetched pages go to the selected model in one request through agent's `complete`, page content marked untrusted, answering one line per page, `<n>: <summary>`, at most 40 words, in the page's language; `-` for pages without meaningful content. Unparseable or missing lines give that link no summary. The model request is aborted with the run (Stop).
6. **Output.** The conversation shows a list item: per target, in page order, the link text (or the linked page's title when the link has no text) as a link, its host, and the summary or "No summary (the page couldn't be read)". Clicking an entry loads that URL in the page view (`navigation.go`). The list is shown even if some pages failed; if every fetch failed or the model request fails, the run ends with an error in the conversation.

## 8. Non-Functional Requirements

- Performance: work only while the skill runs; one model request; ≤ 4 fetches at once.
- Reliability: Stop aborts fetches and the model request; a closed or navigated page before the scan ends the run with an error; a late answer after Stop is ignored.
- Security: one fixed read-only isolated-world script; no DOM changes, no preload, Node or IPC for web content; `secureWebPreferences` unchanged. Prefetch on an in-memory session separate from `persist:browsing`, GET only, no credentials, so it can't act as the user. The tool is not offered to the model. No new IPC channels (the run goes through `skills:run`; the list arrives in `agent:state-changed`).
- Privacy: only on `/link-summaries`: the linked sites see a cookieless request from the user's address, and the linked pages' extracted text (not the current page's) goes to the selected model. Summaries live only in the conversation (cleared with `/new`).
- Accessibility: the list is a real list of links (keyboard reachable, visible focus); entries use the panel's colours.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: on an article, `/link-summaries` → "✓ Summarise the linked pages" → a list "Linked pages" with "**Checkpoints** · en.wikipedia.org – How SQLite moves WAL pages back…" entries; click one to open it.
- Visual considerations: list in the conversation's assistant style; link text in the accent colour; host muted.
- Edge cases: the same target linked twice (listed once, first link text); pages that redirect to a login wall (summarised as such, or `-` → no summary); a page with no main-text links.

## 10. Technical Notes

- Proposed approach: new feature `link-summaries` (main only): `shared/page-scripts.ts` (`collectLinks`), `shared/extract.ts` (HTML → gist), `main/prefetch.ts`, `main/summarize.ts` (prompt, parse), `main.ts` registers a `LinkSummaryPort` with agent (`provideLinkSummaries`), reading the active page through navigation's `getPage`. agent: `summarize_links` tool (`kind: 'read'`, `skillOnly`), a `links` conversation item rendered by `ui/Conversation.tsx`, `toolsFor` and `callTool` skip skill-only tools. skills: the built-in.
- Process split: main does the scan, fetch and model request; the chrome UI only renders the conversation item and calls `window.antimony.navigation.go` on click.
- Dependencies: navigation (`getPage`), agent (`complete`, `provideLinkSummaries`), skills (built-in); Electron `session.fromPartition`, `Session.fetch`, `executeJavaScriptInIsolatedWorld`. No npm packages.
- Risks / unknowns: model latency (one CLI turn, seconds); sites rejecting cookieless requests; approximate regex extraction.
- Open questions: –

## 11. Acceptance Criteria

- [x] `/link-summaries` is listed as a built-in skill and replays `summarize_links`; it needs page access and asks no approval – `skills` tests, `agent.test.ts`
- [x] `summarize_links` is not offered to the model, is refused when the model calls it, and can't be a macro step – `tools.test.ts`, `agent.test.ts`
- [x] Link collection: main text only, http(s), deduplicated without fragment, not the page itself, no downloads or file extensions, at most 20, with link text; the page's DOM is unchanged – `shared/page-scripts.test.ts`
- [x] Prefetch uses a non-persistent session of its own, GET without credentials, ≤ 4 at once, HTML only, ≤ 1 MB – `main.test.ts`, `main/prefetch.test.ts`
- [x] HTML extraction yields title, description and visible text ≤ 1,500 characters – `shared/extract.test.ts`
- [x] One model request, content marked untrusted; answer lines map to links by number, bad lines ignored; failed pages listed without summary – `main/summarize.test.ts`, `main.test.ts`
- [x] The conversation shows the list with clickable links that load the URL in the page view – `ui/Conversation.test.tsx`, `e2e/link-summaries.spec.ts`
- [x] Stop aborts the fetches and the model request – `main.test.ts`
- [x] Feature README, `docs/features.md` row, agent and skills READMEs, ADR 0022 written (0021 marked superseded)

## 12. Testing / Verification

- Manual test plan: on a Wikipedia article with page access on, run `/link-summaries`; check the list, click an entry; run it with page access off (error); Stop mid-run.
- Automated test coverage: unit tests above; e2e test with a local article and the fake Claude CLI answering link summary requests.
- Regression considerations: other skills and the model's tool list unchanged apart from the hidden tool; isolated worlds 1001 (agent) and 1002 (history) untouched.

## 13. Rollout / Follow-up

- Rollout plan: available at once as a built-in skill.
- Follow-up work: an optional filter argument; summarising a selection of links.

## 14. Changes during implementation

- The decision record is ADR 0022; the reverted feature's ADR 0021 is kept (append-only) and marked superseded by it, instead of being removed with the revert.
- The page access requirement and "no approval" are checked in `agent.test.ts › summarize_links` (the replay path); the skills test only checks that `/link-summaries` replays the one step.
- Stop: fetches are aborted through the run's signal and no model request follows (`main.test.ts › stops with the run…`); the model request itself gets the same signal.
