# Feature Specification: LLM prompt bar

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | LLM prompt bar (prompt, agent, skills, debug view) |
| **Spec ID** | violet-harbinger-p7w3kd |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-09-30 19:36 +00:00 |
| **Last updated** | 2026-10-01 01:17 +00:00 |
| **Affected features** | navigation, prompt (new), agent (new), skills (new) |
| **Target release** | 0.1.0 |
| **Related links** | [amber-lantern-8qp2hb](./amber-lantern-8qp2hb.md) (Open Location, replaced by this), [quiet-harbor-n7k2x9](./quiet-harbor-n7k2x9.md) (Draft; its address bar is superseded by this prompt) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Antimony has only a bare "Open Location" text box. A location bar only takes URLs; anything else the user wants from the browser means clicking around by hand.
- **Desired outcome:** Ctrl/Cmd+L opens a prompt that looks and behaves like the Claude prompt. It handles input deterministically when it can (URLs → navigate, `/skills` → run), otherwise sends it to Claude, which gets the browser's internal API as tools and can drive the browser. Slow LLM runs can be saved as deterministic `/skills`. A debug panel shows exactly how the model used the browser API.

## 3. Background and Context

- **Current behavior:** File → Open Location… (Ctrl/Cmd+L) shows a text box in the toolbar; Enter loads an http(s) URL in the single page view. No history, no suggestions, no page state in the UI.
- **Motivation:** Make the location bar the one place to tell the browser what to do, in words or URLs, and make repeated LLM work cheap by turning it into commands.
- **Related issues or references:** Security model modelled on Microsoft Edge's Copilot Mode: page context is opt-in, the assistant acts visibly and can be stopped at any time, page actions need the user's approval, and page content is data, never instructions.

## 4. Goals

- Goal 1: One prompt for URLs, slash commands and natural-language requests, with URLs and commands handled without any LLM call.
- Goal 2: Claude (Anthropic Messages API) can read and control the browser through a small, typed tool API, under Edge-like safeguards.
- Goal 3: Any LLM run that acted on the browser can be saved as a `/skill` that replays the same tool calls deterministically, optionally with `{{parameters}}`.
- Goal 4: Suggestions (intellisense) for past URLs, past queries, skills and skill parameters; paste of images and long text as attachments, like the Claude prompt.
- Goal 5: A debug panel shows every model request and response, tool call, argument, result, approval and timing of a run.

## 5. Non-Goals

- Non-goal 1: LLM providers other than Anthropic (the client sits behind a small interface so others can be added later).
- Non-goal 2: Tabs, history pages, bookmarks, a search engine fallback (text that isn't a URL goes to the model, not a search engine).
- Non-goal 3: Streaming token-by-token output (each model step is shown when it completes; follow-up).
- Non-goal 4: Model-generated skills, skill sharing/import/export, skill branching or loops.
- Non-goal 5: Acting on pages other than the one page view; file uploads, downloads, logins done by the agent.

## 6. User Stories

- As a user, I want to press Ctrl+L anywhere, type `example.com` and land there instantly, as in any browser.
- As a user, I want to type "find the pricing page and summarize it" and have the browser do it, seeing what it does and being able to stop it.
- As a user, I want to paste a screenshot into the prompt and ask about it.
- As a user, I want to save "open my team's dashboard and filter by this week" as `/dashboard` so next time it runs instantly without the model.
- As a user, I want suggestions of URLs, questions and commands I used before as I type.
- As the developer, I want to see every request to the model and every browser API call it made, with arguments and results, to understand and debug its behaviour.

## 7. Functional Requirements

### Prompt (feature `prompt`)
1. Ctrl/Cmd+L (File → Prompt…, replacing Open Location…) focuses the chrome UI and expands the prompt card at the top of the window, with focus in its text area; pressing it again while open refocuses and selects the text. Escape (with no suggestion list open) collapses it; while a run is going, Escape stops the run instead.
2. Collapsed, the toolbar shows a compact bar with the page title and URL (clicking it opens the prompt) and, while a run is going, an "Assistant is acting…" indicator with a Stop button.
3. The expanded card, like the Claude prompt: a multi-line auto-growing text area; below it a row with an attach (+) button, a slash (/) button that inserts `/` and opens skill suggestions, the page-access toggle, the model picker, and the send button. Enter sends, Shift+Enter inserts a newline. Above the input, the current conversation (user messages, assistant text, one-line tool step summaries, approvals) scrolls.
4. Input is classified deterministically, in this order (pure function in `prompt/shared/classify.ts`):
   1. starts with `/` → a command: built-in command or saved skill with positional arguments; unknown name → inline error with the closest suggestions, nothing sent to the model;
   2. starts with `?` → forced LLM query (the `?` is removed), e.g. `? example.com` asks about the text instead of navigating;
   3. no attachments and `toUrl(input)` accepts it → navigate via `navigation:go`, the prompt collapses;
   4. anything else → LLM query (with attachments). Without an API key, the prompt shows how to set one (`/key`) and sends nothing.
5. Built-in commands: `/back`, `/forward`, `/reload`, `/stop` (page loading), `/new` (new conversation), `/debug` (toggle debug panel), `/key` (set or clear the Anthropic API key), `/model <id>`, `/page-access on|off`, `/save <name>` (save the last run as a skill), `/skills` (list saved skills), `/forget <name>` (delete a saved skill), `/forget-history` (clear prompt history).
6. Suggestions (intellisense) appear under the input as the user types, up to 8 rows, each with an icon for its kind (URL, query, skill, parameter value): prefix/substring matches over past URLs, past queries, built-in commands and saved skills (skills show their parameter signature, e.g. `/dashboard <team>`), and, after a skill name, past values for its next parameter. ↑/↓ move, Tab/→ accept into the input, Enter accepts and submits, Escape closes the list. With an empty input and ↑, the input steps back through past prompts like a shell.
7. History: every submitted URL (after `toUrl`), query text and command is recorded (most recent first, de-duplicated, capped at 500 entries) in `userData/prompt-history.json`. `/forget-history` clears it. Attachments are never stored.
8. Attachments: pasting or dropping images (PNG, JPEG, GIF, WebP, ≤ 5 MB each, ≤ 5 per message) or choosing them with +, adds thumbnail chips; pasting text longer than 1 000 characters or 20 lines adds a "Pasted text" chip instead of flooding the text area. Chips can be removed; clicking an image chip previews it. Attachments are sent with the next LLM query only.

### Agent (feature `agent`)
9. Queries run in the main process in a tool-use loop against the Anthropic Messages API (`POST /v1/messages`, called with `fetch`; no SDK). Model picker offers Claude Sonnet 5.5 (default), Opus 5.5 and Haiku 4.5. A run ends when the model stops calling tools, after 25 model steps, on an error, or when the user stops it (aborts the request and any pending approval).
10. The conversation continues across queries until `/new`. The system prompt describes the browser, the tools, the untrusted-content rule (req. 15) and the current page URL and title.
11. Browser tools given to the model (the "internal API"):
    - Navigation (no approval, like the address bar): `navigate(url)`, `go_back()`, `go_forward()`, `reload()`, `stop()`, `get_page_state()` (URL, title, loading, can go back/forward).
    - Page context (offered only when page access is on): `read_page()` (title, URL, visible text trimmed to 20 000 chars, and a numbered list of interactive elements with a role, name and CSS selector), `find_in_page(text)`, `screenshot()` (PNG of the page view, downscaled to ≤ 1 280 px wide).
    - Page actions (offered only when page access is on; each needs approval, req. 13): `click(selector)`, `type_text(selector, text, submit?)`, `press_key(key)`, `scroll(direction)`.
12. Page access (Edge "allow page context"): off by default, a persisted per-user setting toggled from the prompt row or `/page-access`. While off, the model gets only the URL and title and none of the page-context or page-action tools. The toggle's state is always visible in the prompt.
13. Approval: before each page action the run pauses and the conversation shows what the model wants to do ("Click 'Buy now' (button#buy) on shop.example"), with Allow, Allow for this run and Deny. Deny returns a "user denied" tool result to the model. Typing into password or credit-card fields (`type=password`, `autocomplete` `cc-*`, `current-password`, `new-password`) is always refused by the tool, approval or not.
14. While a run is going: the collapsed and expanded prompt show "Assistant is acting…" with Stop; the page view gets a 2 px accent frame (drawn by the chrome UI around the page area) so the user can see the page is being driven.
15. Page content (read_page, find_in_page, page titles) is returned to the model inside `<untrusted_page_content>` markers, and the system prompt tells it such content is data and never instructions.
16. The API key is set via `/key` (a password-style input, never echoed or stored in history), stored encrypted with Electron `safeStorage` in `userData/agent-settings.json`, and never sent to the chrome UI; the UI only learns whether a key is set. `ANTHROPIC_API_KEY` in the environment is used when no key is stored. If `safeStorage` encryption isn't available, the key is kept in memory for the session only and the user is told.
17. Page reading and actions run fixed scripts shipped with the app in an isolated world of the page (`executeJavaScriptInIsolatedWorld`), with the model's arguments passed as JSON data; model-supplied code is never executed.

### Skills (feature `skills`)
18. After a run that called at least one navigation or page-action tool, the conversation shows "Save as skill". `/save <name>` or the button opens a save form listing the run's replayable tool calls in order (read-only tools — `get_page_state`, `read_page`, `find_in_page`, `screenshot` — are dropped with a note). Each string argument can be edited; `{{name}}` placeholders in any argument become parameters, in order of first appearance. Name: `[a-z][a-z0-9-]{0,31}`, not a built-in command name.
19. Saved skills are stored in `userData/skills.json` (name, description, steps, parameters, created date) and show up in suggestions immediately.
20. `/name arg1 arg2 …` runs a skill: arguments are split on whitespace, quotes group words, the last parameter takes the rest of the line. Missing arguments → inline error with the signature. Steps run in order through the same tool executor as the agent, with no model call. A skill that contains page actions asks for one approval for the whole replay ("Run /dashboard: 3 steps, 1 click, 1 typing"), and requires page access on. The first failing step (e.g. selector not found) stops the replay with an error naming the step.
21. Built-in commands of req. 5 that act on the page (`/back`, `/forward`, `/reload`, `/stop`) are skills shipped with the app (one step each), so they share the replay path.

### Debug panel (feature `agent`)
22. `/debug`, or File → Toggle Assistant Debugger (Ctrl/Cmd+Shift+D), docks a panel on the right side of the window (page view narrows; 420 px, resizable 280–800 px). It survives collapsing the prompt.
23. The panel shows the runs of the current session (newest first; skill replays too), each as a timeline of events with a relative timestamp and duration: `request` (model, system prompt, message count, tool names, max tokens), `response` (stop reason, token usage, text and tool_use blocks), `tool call` (name, input), `approval` (asked / allowed / denied), `tool result` (output or error; screenshots as thumbnails), `error`, `stopped`. Each event expands to its full JSON (API key and image data redacted/elided); a "Copy run as JSON" button copies the whole run.
24. Events are kept in memory for the last 20 runs only; closing the app clears them.

### Navigation (feature `navigation`, changed)
25. The Open Location UI and its menu item are removed; `navigation:go` stays.
26. Navigation exports a page-control object from `main.ts` (load URL with the `toUrl` check, back, forward, reload, stop, state, the page `webContents` for the agent's scripts and screenshots) and sends `navigation:state-changed` (URL, title, loading, can go back/forward) to the UI.
27. The chrome UI reports the space it covers (`navigation:set-insets`: top and right, integers 0–4 000) and the page view is laid out in the rest; the prompt card and the debug panel change these insets. `TOOLBAR_HEIGHT` stays the initial top inset.

## 8. Non-Functional Requirements

- Performance: URL and command input never waits on the network; suggestion filtering stays under 16 ms for 500 history entries + 100 skills. History and skills load once at start and are written debounced (≤ 1 write/s).
- Reliability: Network errors, API errors (4xx/5xx, including 401 bad key and 429 rate limit), a destroyed/crashed page, and invalid tool inputs end the run with a readable message in the conversation and an `error` debug event; the app never crashes. Corrupt JSON stores are renamed to `*.corrupt-<time>.json` and replaced with empty ones.
- Security: New IPC (all through `ctx.ipc`, every argument validated): `prompt:*` (history get/add/clear, open event), `agent:*` (run, stop, approve, settings, set key, debug events, state events), `skills:*` (list, save, delete, run), `navigation:state-changed`, `navigation:set-insets`. The API key never reaches the renderer. Web content still gets no preload, Node or IPC; the agent's scripts run in an isolated world and only read the DOM or dispatch DOM input on elements selected by CSS selector. New capability recorded in an ADR: page text/screenshots can be sent to Anthropic (only with page access on), and the model can click/type in the page (only with per-action or per-replay approval). `secureWebPreferences` unchanged.
- Privacy: Sent to Anthropic: prompts, attachments, page URL/title, and — only with page access on — page text and screenshots. Stored locally: prompt history (clear with `/forget-history`), skills, settings, encrypted key. Debug events are memory-only.
- Accessibility: The prompt is a labelled `textarea` ("Prompt"); suggestions use the ARIA combobox/listbox pattern; approval buttons are keyboard reachable and the approval request is announced (`role="alertdialog"`); the acting indicator is `role="status"`.
- Platforms: Same on all platforms; Cmd on macOS. `safeStorage` on Linux may fall back to session-only keys (req. 16).

## 9. UX / UI Notes

- User flow: Ctrl+L → card expands (page view moves down) → type → suggestions → Enter → URL loads and card collapses, or the conversation grows while the assistant works, with steps and approvals inline → Escape collapses; the conversation remains for the next Ctrl+L until `/new`.
- Visual considerations: Follow the attached Claude prompt: rounded card with accent border, dark/light via `prefers-color-scheme`, placeholder "Ask, type a URL, or / for skills", icon-only row buttons with tooltips, model name + effort-less label ("Sonnet 5.5"), send button as a filled square with an arrow, disabled when empty. Plain CSS with custom properties, no UI library. Card width `min(760px, 100% - 32px)`, conversation area max 50 % of the window height.
- Edge cases: Ctrl+L while a run is going (card opens, shows the run); submit while a run is going (queries are rejected with "Stop the current run first", URLs and navigation commands still work and the agent is told on its next step via the page state); page not yet loaded when a page tool is called (tool error "No page is loaded"); huge pages (text trimmed, noted in the result); skill replay with page access off (error suggesting `/page-access on`).

## 10. Technical Notes

- Proposed approach: Four slices. `prompt` owns the card UI, classification, suggestions and history. `agent` owns the Anthropic client, the tool executor (in main, used by both LLM runs and skill replays), approvals, settings, the key and the debug log/panel. `skills` owns the skill store, the save form and argument parsing, and replays through `agent`'s exported executor. `navigation` keeps the page view and exposes page controls.
- Process split:
  - main: `agent/main.ts` (run loop, `anthropic.ts` client, `tools.ts` executor, `page-scripts.ts` fixed isolated-world scripts, `settings.ts` safeStorage), `prompt/main.ts` (history JSON, menu item), `skills/main.ts` (store, replay), `navigation/main.ts` (page controls, insets).
  - UI → main (invoke): `prompt:history`, `prompt:record`, `prompt:clear-history`, `agent:run`, `agent:stop`, `agent:approve`, `agent:new-conversation`, `agent:settings`, `agent:update-settings`, `agent:set-key`, `agent:debug-log`, `skills:list`, `skills:save`, `skills:delete`, `skills:run`, `navigation:go`, `navigation:back|forward|reload|stop`, `navigation:set-insets`.
  - main → UI (events): `prompt:open`, `agent:run-changed` (conversation, status, pending approval), `agent:debug-event`, `agent:toggle-debug`, `navigation:state-changed`.
- Dependencies: Electron `safeStorage`, `webContents.executeJavaScriptInIsolatedWorld`, `capturePage`, `nativeImage`; Node `fetch`, `AbortController`; `navigation/shared/to-url.ts` (prompt uses it for classification). No new npm packages. The shell's `MainContext` is unchanged; cross-feature calls go through `main.ts` exports (agent → navigation, skills → agent, prompt → agent/skills via their IPC in the UI), listed in each README.
- Risks / unknowns: Prompt injection from page content (mitigated by opt-in page access, untrusted-content markers, approvals for actions, visible acting state, step limit; not eliminable — recorded in the ADR). CSS selectors from `read_page` may be unstable across page versions, so skills can break when a site changes (clear per-step error). The page view sits above the chrome UI, so the card must reserve space via insets rather than overlap the page.
- Open questions: –

## 11. Acceptance Criteria

- [x] Ctrl/Cmd+L opens and focuses the prompt from the page or the chrome UI; Escape collapses it (unit + e2e).
- [x] `classify` routes `/…` to commands, `?…` to the model, URL-like text (no attachments) to navigation and everything else to the model (unit).
- [x] Typing a URL and Enter loads it in the page view with no model request (e2e with a fake Anthropic server asserting zero requests).
- [x] Suggestions show matching past URLs, queries, built-ins and skills with parameter signatures and past parameter values; keyboard navigation works (unit).
- [x] History persists across restarts, is capped and de-duplicated, never contains attachments or the API key, and `/forget-history` clears it (unit).
- [x] Pasting an image adds a thumbnail chip and the next query sends it as an image block; long pasted text becomes a chip (unit).
- [x] An LLM query runs a tool loop: the fake model calls `navigate`, the page loads, the final text shows in the conversation (e2e with fake Anthropic server; unit for the loop).
- [x] With page access off, the request's tool list has no page-context or page-action tools and page text is never sent (unit).
- [x] Page actions wait for approval; Deny sends a denial result; password/card fields are refused even when allowed (unit; page script unit-tested in jsdom).
- [x] Stop aborts the model request and any pending approval, and the run ends as stopped (unit).
- [x] Page content returned to the model is wrapped in untrusted markers (unit).
- [x] The API key is stored encrypted, never reaches the renderer (no IPC payload contains it), `ANTHROPIC_API_KEY` is the fallback (unit).
- [x] "Save as skill" saves replayable steps with `{{params}}`; `/name args` replays them without any model request, asks one approval if it has page actions, and stops on the first failing step (unit + e2e).
- [x] `/back`, `/forward`, `/reload`, `/stop` work as built-in skills (unit).
- [x] The debug panel toggles with Ctrl/Cmd+Shift+D and `/debug`, narrows the page view, and shows request, response, tool call, approval, tool result and error events with expandable JSON and redacted key (unit + e2e).
- [x] Every new IPC handler rejects malformed arguments (unit).
- [x] The page view is laid out below the prompt and left of the debug panel and follows inset changes and window resizes (unit).
- [x] ADR for the agent's capabilities and data flow; READMEs for prompt, agent, skills; navigation README updated; `docs/features.md` regenerated.

## 12. Testing / Verification

- Manual test plan: `npm run dev`; Ctrl+L → `example.com`; Ctrl+L → "what is on this page?" with page access off, then on; ask it to click a link, try Deny and Allow; Stop mid-run; save the run as `/x`, run `/x`; paste an image and ask about it; toggle the debug panel and inspect every event; restart and check history suggestions.
- Automated test coverage: unit (Vitest) for classify, suggestions, argument parsing, history/skills stores, Anthropic request building and response parsing (fetch mocked), run loop, approvals, tool executor with a fake page, page scripts in jsdom, IPC validation, UI components (prompt card, suggestions, attachments, approvals, debug panel, save form); e2e (Playwright) with a local fake Anthropic server via `ANTHROPIC_BASE_URL`.
- Regression considerations: navigation e2e tests move from Open Location to the prompt; new-window links still load in the page view.

## 13. Rollout / Follow-up

- Rollout plan: merge to main; no flag (the prompt replaces Open Location outright; LLM features are inert without a key).
- Follow-up work: streaming responses; more providers; tabs-aware tools; model-generated skills; skill export; history search engine fallback; revisiting the untrusted-content defence as Anthropic/Edge guidance evolves.

## 14. Changes during implementation

- **Cross-site navigation after reading a page needs approval** (req. 11/13 said navigation never needs approval). Once a run has read page content, `navigate` to another host (ignoring `www.`) asks like a page action, closing the easiest prompt-injection exfiltration path (page data in a URL). Recorded in ADR 0004.
- **`scroll` needs page access but no approval** (req. 11 listed it as a page action). It has no side effects; it is still replayable in skills.
- **Screenshots are JPEG** (quality 80, ≤ 1 280 px wide) instead of PNG, to stay well under the API's image size limit; the debugger gets a 320 px thumbnail.
- **Anthropic request details:** adaptive thinking with `display: "summarized"` (summaries show in the debugger) and `effort: "medium"` on Sonnet 5.5 / Opus 5.5, server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) on those models, top-level prompt caching, `max_tokens` 16 000; Haiku 4.5 gets none of these. `stop_reason: "refusal"` shows a notice.
- **Page state goes in each user turn** (`<browser_state>` block) instead of the system prompt (req. 10), so the system prompt and tools stay cacheable.
- **The prompt uses `window.antimony.navigation.toUrl`** (run in navigation's preload) instead of importing `navigation/shared/to-url.ts`, to respect the cross-feature import rule.
- **Page insets have four sides** (req. 27 said top and right) and come from a `PageArea` component that measures its own box, so the acting frame (req. 14) is drawn by insetting the page by 2 px on every side.
- **The card stays expanded while an approval is pending**, so a collapsed prompt can't hide the question.
- **`/key <key>` inline** also works (never recorded; history keeps `/key`), besides the password field; `/key clear` removes the key.
- **Built-in skill runs appear in the conversation** (they share the replay path, req. 21).
- **`page-scripts.ts` references the DOM lib** (`/// <reference lib="dom" />`) because main-process code imports it but it runs in pages.
- **e2e runs each launch with a fresh `--user-data-dir`**, so settings, history and skills don't leak between tests. In this session the Electron binary could be downloaded, so the Playwright suite (8 tests, including a real page read, screenshot, typing, click and approvals against a local fake Anthropic server) was run locally, not only in CI.
- Found by the tests and screenshots and fixed along the way: the skills file format (`{ skills }`), element roles in approval text ("link", not "a"), a CSS class collision between debugger rows and the approval box, a duplicate pending-approval line.
