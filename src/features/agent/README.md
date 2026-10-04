# agent

Lets Claude (through an Anthropic API key or the user's own Claude Code CLI login) or a local Ollama model carry out requests typed into the prompt by calling the browser's own tools: navigate, search browsing history, read the page, click and type, each page action only with the user's approval. Its debugger shows every model request, response, tool call and result of a run.

## Entry points
- UI: `ui/Conversation.tsx` (conversation, approvals, "Save as skill") filling the assistant panel above the prompt, following new items unless scrolled up; `ui/ActingFrame.tsx` around the page area; `ui/DebugPanel.tsx` docked between the page area and the assistant panel – all mounted in `App.tsx`
- IPC: `agent:run|stop|approve|new-conversation|state|settings|update-settings|set-key|models|debug-log|toggle-debug` (UI → main); `agent:state-changed`, `agent:settings-changed`, `agent:debug-log-changed`, `agent:debug-toggled` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – File → Toggle Assistant Debugger (Ctrl/Cmd+Shift+D); exports `replay`, `savableSteps`, `isReplayableTool` for skills, `provideHistorySearch` (history's search for the `search_history` tool) and `complete` (one request to the selected model, no tools, optionally with labelled JPEGs; for history's summaries, Meaning search and Recall). Run loop `main/agent.ts` (its own model loop for the API and Ollama; for `cli:` models one CLI turn per request), client `main/anthropic.ts` (fetch, no SDK; also Ollama's compatible `/v1/messages`), Ollama address and model list `main/ollama.ts`, Claude Code CLI (`claude -p`, stream-json, login check, `complete`) `main/claude-cli.ts` with its per-run tool server `main/mcp-server.ts` (MCP over loopback HTTP, no SDK), tools `main/tools.ts`, page adapter `main/browser.ts`, key and settings `main/settings.ts`
- Shared: `shared/page-scripts.ts` – the fixed scripts run in the page's isolated world

## Invariants
- Without page access only navigation tools and `search_history` are offered and page tools are refused – `main/agent.test.ts › offers no page tools…`, `main/tools.test.ts › toolsFor`
- With history access off (`/history-access off`) `search_history` is neither offered nor run – `main/agent.test.ts › history search is neither offered…`, `main/tools.test.ts › leaves out history search…`
- History search results are untrusted and, like reading a page, make leaving the site later in the run need approval – `main/tools.test.ts › search_history`, `main/agent.test.ts › also after a history search…`
- Every click, key press and typing, and any navigation to another site after page content was read, waits for Allow / Allow for this run; Deny reaches the model as a denied result – `main/agent.test.ts › waits for approval…`, `› tells the model when the user denies…`, `› cross-site navigation after reading a page`, `e2e/prompt.spec.ts › with page access…`
- Never types into password or payment card fields – `main/agent.test.ts › refuses typing into sensitive fields…`, `shared/page-scripts.test.ts › flags password…`
- Page content reaches the model inside `<untrusted_page_content>` – `main/tools.test.ts › untrusted`, `e2e/prompt.spec.ts`
- The API key never reaches the renderer and is stored only encrypted – `main.test.ts › never sends the API key…`, `main/settings.test.ts`
- `complete` uses the selected model and the same key rules, sends no tools, puts each labelled image right after its label, and returns only text – `main.test.ts › answers single requests…`
- Ollama models (`ollama:<name>`) run without a key and get no Anthropic-only request fields or key header; the server address comes only from `OLLAMA_HOST` – `main.test.ts › runs Ollama models…`, `main/anthropic.test.ts`, `main/ollama.test.ts`
- CLI models (`cli:<claude id>`) never get Antimony's key (`ANTHROPIC_*` stripped from the CLI's environment), run with no built-in CLI tools and none of the user's CLI settings, hooks or MCP servers, and reach the browser tools only through the same `callTool` path (approvals, page access, refusals) – `main/claude-cli.test.ts`, `main/agent.test.ts › Agent.run with the Claude Code CLI`, `main.test.ts › runs Claude Code CLI models…`
- The MCP server lives for one run on 127.0.0.1 and refuses requests without the run's token, with an `Origin` or with another `Host` – `main/mcp-server.test.ts`
- API/Ollama history and the CLI session don't mix: changing between them starts the model fresh, with a notice – `main/agent.test.ts › starts fresh, with a notice…`
- Model history is append-only; every `tool_use` gets a `tool_result`, also after Stop – `main/agent.test.ts › stop during an approval…`
- A run ends after 25 model steps – `main/agent.test.ts › ends with an error after the step limit`

## Dependencies
- Features: navigation (`getPage` from `main.ts`, the active tab, `NavigationState` from `ipc.ts`); history calls `provideHistorySearch` (the agent doesn't import history)
- App: `createJsonStore` (`src/app/main/json-store.ts`)
- Electron: `safeStorage`, `webContents.executeJavaScriptInIsolatedWorld`, `sendInputEvent`, `insertText`, `capturePage`
- Network: `POST https://api.anthropic.com/v1/messages` (`ANTHROPIC_BASE_URL` overrides); for Ollama models `POST {OLLAMA_HOST}/v1/messages` and `GET {OLLAMA_HOST}/api/tags` (default `http://localhost:11434`, Ollama ≥ 0.14); e2e uses a local fake for both
- Processes: the Claude Code CLI (`CLAUDE_CLI_PATH`, else `claude` on PATH or in its install folders; `auth status --json` for the picker) with cwd `userData/claude-cli/`; it talks to Anthropic under the user's Claude Code account. e2e and `main.test.ts` use `e2e/fixtures/fake-claude.mjs`
- Stored data: `userData/agent-settings.json` (model, page access, history access, safeStorage-encrypted key); debug log in memory only (last 20 runs); CLI conversations are saved by the CLI in its own sessions folder (for `--resume`); the MCP config (URL + token) is a 0600 temp file deleted after each run

## Security surface
- IPC: the chrome UI can start runs, answer approvals, change model, page access and history access, set the key (write-only) and list models (ids and labels only; it can't change the Ollama address, the CLI path or any CLI argument).
- Main: `complete` lets other features' main code send text and JPEGs to the selected model; they decide what may be sent (history: ADR 0006, 0010).
- History: unless history access is off (default on), in any run, also with page access off, the model can search browsing history and sees up to 20 matching pages' titles, URLs, notes and summaries (ADR 0012).
- Web content: with page access on, the model reads page text, element lists and screenshots (sent to Anthropic – through the CLI for `cli:` models – or to Ollama for `ollama:` models) and, after approval, clicks and types via trusted input events. Navigation needs no approval until the run has read a page; then leaving the site needs approval too (ADR 0004).

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd, copper-lantern-o7l4ma, still-meridian-r4v8nc, ember-ledger-h3x8vq, quartz-relay-c8m2vt, drifting-nimbus-r8c3kw, patient-archive-h6q2wn, quiet-ledger-t9m4rx · ADRs: 0004, 0005, 0006, 0009, 0010, 0012
