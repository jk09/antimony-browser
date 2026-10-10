# agent

Lets Claude, through the user's own Claude Code CLI and its login, carry out requests typed into the prompt by calling the browser's own tools: navigate, open stacks, search browsing history, read the page, click and type, each page action only with the user's approval, and store macros (`/name` scripts of those tool calls) when asked. The model picker offers the Claude model strengths (Haiku 4.5, Sonnet 5.5, Opus 5.5). Its debugger shows every request, response, tool call and result of a run, and `checkCli` tests the CLI for the welcome page.

## Entry points
- UI: `ui/Conversation.tsx` (conversation, approvals) filling the assistant panel above the prompt, following new items unless scrolled up; `ui/ActingFrame.tsx` around the page area; `ui/DebugPanel.tsx` docked between the page area and the assistant panel – all mounted in `App.tsx`
- IPC: `agent:run|stop|approve|new-conversation|state|settings|update-settings|check-cli|debug-log|toggle-debug` (UI → main); `agent:state-changed`, `agent:settings-changed`, `agent:debug-log-changed`, `agent:debug-toggled` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – File → Toggle Assistant Debugger (Ctrl/Cmd+Shift+D); exports `replay`, `checkStep`, `isReplayableTool` and `provideMacros` (the macro store for `save_macro`, `list_macros`, `delete_macro`) for skills, `provideStackOpener` (stacks' Ctrl/Cmd+N for `new_stack`), `provideHistorySearch` (history's search and Recall for the `search_history` and `recall_history` tools; the current request's image attachments and the run's abort signal reach `recall_history` through `ToolPorts`) and `complete` (one request to the selected model, no tools, optionally with labelled JPEGs; for history's summaries, Meaning search and Recall). Run loop `main/agent.ts` (one CLI turn per request; every tool the CLI calls goes through `callTool`), Claude Code CLI (`claude -p`, stream-json, login check, `checkCli`, `complete`) `main/claude-cli.ts` with its per-run tool server `main/mcp-server.ts` (MCP over loopback HTTP, no SDK), content blocks `main/content.ts`, tools `main/tools.ts`, page adapter `main/browser.ts`, settings `main/settings.ts`
- Shared: `shared/page-scripts.ts` – the fixed scripts run in the page's isolated world

## Invariants
- `navigate` fails with `Could not load <url>: <reason>` when the page cannot load (connection refused, DNS, …) instead of reporting success, so a macro stops at that step – `main/tools.test.ts › reports a page that fails to load…`
- Without page access only navigation tools, `search_history` and `recall_history` are offered and page tools are refused – `main/agent.test.ts › offers no page tools…`, `main/tools.test.ts › toolsFor`
- With history access off (`/history-access off`) `search_history` and `recall_history` are neither offered nor run – `main/agent.test.ts › history search is neither offered…`, `main/tools.test.ts › leaves out history search and recall…`
- History search and recall results are untrusted and, like reading a page, make leaving the site later in the run need approval – `main/tools.test.ts › search_history`, `› recall_history`, `main/agent.test.ts › also after a history search…`, `› recalls by an attached image…`
- `recall_history` only uses images attached to the current request (by number) and is aborted when the run stops – `main/tools.test.ts › uses the n-th attached image…`, `main/agent.test.ts › aborts a recall…`
- Every click, key press and typing, and any navigation to another site after page content was read, waits for Allow / Allow for this run; Deny reaches the model as a denied result – `main/agent.test.ts › waits for approval…`, `› tells the model when the user denies…`, `› cross-site navigation after reading a page`, `e2e/prompt.spec.ts › with page access…`
- Never types into password or payment card fields – `main/agent.test.ts › refuses typing into sensitive fields…`, `shared/page-scripts.test.ts › flags password…`
- Macro tools need no page access; after page or history content was read in the run, saving or deleting a macro waits for approval; `<browser_state>` lists the saved macros – `main/agent.test.ts › macros`
- Page content reaches the model inside `<untrusted_page_content>` – `main/tools.test.ts › untrusted`, `e2e/prompt.spec.ts`
- `complete` runs the selected model through the CLI without tools or session, puts each labelled image right after its label, and returns only text – `main.test.ts › answers single requests…`
- The CLI never gets an API key (`ANTHROPIC_*` stripped from its environment), runs with no built-in CLI tools and none of the user's CLI settings, hooks or MCP servers, and reaches the browser tools only through the same `callTool` path (approvals, page access, refusals) – `main/claude-cli.test.ts`, `main/agent.test.ts › Agent.run with the Claude Code CLI`, `main.test.ts › runs the assistant through the Claude Code CLI…`
- The MCP server lives for one run on 127.0.0.1 and refuses requests without the run's token, with an `Origin` or with another `Host` – `main/mcp-server.test.ts`
- Only the Claude model ids are accepted; settings stored with `cli:` ids, Ollama ids or an API key load as the Claude model / default and drop the key – `main/settings.test.ts › migrates settings…`
- `checkCli` stops at the first failing step (not found, logged out, no answer within 60 s) and never rejects – `main/claude-cli.test.ts › checkCli`
- A run ends after 25 model steps (`--max-turns`) – `main/agent.test.ts › ends with an error after the step limit`

## Dependencies
- Features: navigation (`getPage` from `main.ts`, the active tab, `NavigationState` from `ipc.ts`); history calls `provideHistorySearch`, skills `provideMacros`, stacks `provideStackOpener` (the agent imports none of them)
- App: `createJsonStore` (`src/app/main/json-store.ts`)
- Electron: `webContents.executeJavaScriptInIsolatedWorld`, `sendInputEvent`, `insertText`, `capturePage`
- Network: none of its own; the CLI talks to Anthropic
- Processes: the Claude Code CLI (`CLAUDE_CLI_PATH`, else `claude` on PATH or in its install folders, looked up for every use; `auth status --json` for `checkCli`) with cwd `userData/claude-cli/`; it talks to Anthropic under the user's Claude Code account. e2e and `main.test.ts` use `e2e/fixtures/fake-claude.mjs`
- Stored data: `userData/agent-settings.json` (model, page access, history access); debug log in memory only (last 20 runs); CLI conversations are saved by the CLI in its own sessions folder (for `--resume`); the MCP config (URL + token) is a 0600 temp file deleted after each run

## Security surface
- IPC: the chrome UI can start runs, answer approvals, change model, page access and history access, and run `checkCli` (step results and messages only; it can't change the CLI path or any CLI argument).
- Main: `complete` lets other features' main code send text and JPEGs to the selected model; they decide what may be sent (history: ADR 0006, 0010).
- Macros: the model can save, list and delete macros (ADR 0013); their signatures go to the model with every request.
- History: unless history access is off (default on), in any run, also with page access off, the model can search browsing history and sees up to 20 matching pages' titles, URLs, notes and summaries (ADR 0012), or recall pages with scores and keywords; with an image the user attached, that image and up to 16 small history screenshots go to the model (ADR 0014).
- Web content: with page access on, the model reads page text, element lists and screenshots (sent to Anthropic through the CLI) and, after approval, clicks and types via trusted input events. Navigation needs no approval until the run has read a page; then leaving the site needs approval too (ADR 0004).

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd, copper-lantern-o7l4ma, still-meridian-r4v8nc, ember-ledger-h3x8vq, quartz-relay-c8m2vt, drifting-nimbus-r8c3kw, patient-archive-h6q2wn, quiet-ledger-t9m4rx, spoken-macro-m4q7zt, amber-orbit-q7t3vn, first-light-w5k8rd · ADRs: 0004, 0006, 0009, 0010, 0012, 0013, 0014, 0015
