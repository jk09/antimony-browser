# agent

Lets Claude (Anthropic Messages API) or a local Ollama model carry out requests typed into the prompt by calling the browser's own tools: navigate, read the page, click and type, each page action only with the user's approval. Its debugger shows every model request, response, tool call and result of a run.

## Entry points
- UI: `ui/Conversation.tsx` (conversation, approvals, "Save as skill") inside the prompt card; `ui/ActingFrame.tsx` around the page area; `ui/DebugPanel.tsx` docked on the right – all mounted in `App.tsx`
- IPC: `agent:run|stop|approve|new-conversation|state|settings|update-settings|set-key|models|debug-log|toggle-debug` (UI → main); `agent:state-changed`, `agent:settings-changed`, `agent:debug-log-changed`, `agent:debug-toggled` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – File → Toggle Assistant Debugger (Ctrl/Cmd+Shift+D); exports `replay`, `savableSteps`, `isReplayableTool` for skills. Run loop `main/agent.ts`, client `main/anthropic.ts` (fetch, no SDK; also Ollama's compatible `/v1/messages`), Ollama address and model list `main/ollama.ts`, tools `main/tools.ts`, page adapter `main/browser.ts`, key and settings `main/settings.ts`
- Shared: `shared/page-scripts.ts` – the fixed scripts run in the page's isolated world

## Invariants
- Without page access only navigation tools are offered and page tools are refused – `main/agent.test.ts › offers no page tools…`, `main/tools.test.ts › toolsFor`
- Every click, key press and typing, and any navigation to another site after page content was read, waits for Allow / Allow for this run; Deny reaches the model as a denied result – `main/agent.test.ts › waits for approval…`, `› tells the model when the user denies…`, `› cross-site navigation after reading a page`, `e2e/prompt.spec.ts › with page access…`
- Never types into password or payment card fields – `main/agent.test.ts › refuses typing into sensitive fields…`, `shared/page-scripts.test.ts › flags password…`
- Page content reaches the model inside `<untrusted_page_content>` – `main/tools.test.ts › untrusted`, `e2e/prompt.spec.ts`
- The API key never reaches the renderer and is stored only encrypted – `main.test.ts › never sends the API key…`, `main/settings.test.ts`
- Ollama models (`ollama:<name>`) run without a key and get no Anthropic-only request fields or key header; the server address comes only from `OLLAMA_HOST` – `main.test.ts › runs Ollama models…`, `main/anthropic.test.ts`, `main/ollama.test.ts`
- Model history is append-only; every `tool_use` gets a `tool_result`, also after Stop – `main/agent.test.ts › stop during an approval…`
- A run ends after 25 model steps – `main/agent.test.ts › ends with an error after the step limit`

## Dependencies
- Features: navigation (`getPage` from `main.ts`, `NavigationState` from `ipc.ts`)
- App: `createJsonStore` (`src/app/main/json-store.ts`)
- Electron: `safeStorage`, `webContents.executeJavaScriptInIsolatedWorld`, `sendInputEvent`, `insertText`, `capturePage`
- Network: `POST https://api.anthropic.com/v1/messages` (`ANTHROPIC_BASE_URL` overrides); for Ollama models `POST {OLLAMA_HOST}/v1/messages` and `GET {OLLAMA_HOST}/api/tags` (default `http://localhost:11434`, Ollama ≥ 0.14); e2e uses a local fake for both
- Stored data: `userData/agent-settings.json` (model, page access, safeStorage-encrypted key); debug log in memory only (last 20 runs)

## Security surface
- IPC: the chrome UI can start runs, answer approvals, change model and page access, set the key (write-only) and list models (ids and labels only; it can't change the Ollama address).
- Web content: with page access on, the model reads page text, element lists and screenshots (sent to Anthropic, or to Ollama for `ollama:` models) and, after approval, clicks and types via trusted input events. Navigation needs no approval until the run has read a page; then leaving the site needs approval too (ADR 0004).

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd, copper-lantern-o7l4ma · ADRs: 0004, 0005
