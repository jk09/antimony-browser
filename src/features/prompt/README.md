# prompt

The assistant panel docked on the right of the window, with a location bar shaped like the Claude prompt at its bottom: Ctrl/Cmd+L focuses it, a URL loads the page, `/command` runs a command or skill, and anything else is a request for the assistant. It suggests past URLs, questions, commands and skill arguments, and takes pasted images and long text as attachments. The page keeps its size while the conversation grows.

## Entry points
- UI: `ui/AssistantPanel.tsx` – mounted on the right edge in `App.tsx`: page title and URL, the `conversation` and `form` slots (agent's `Conversation`, skills' `SaveSkill`), then `ui/Prompt.tsx`; 400 px, resizable 300–720 px, × hides it, Ctrl/Cmd+L, an approval or a skill save shows it
- UI: `ui/Prompt.tsx` – the card at the panel's bottom, suggestions above the input; its model picker groups Claude and installed Ollama models (`agent.models()`, refreshed at start, on Ctrl/Cmd+L and on focus); `ui/commands.ts` built-in commands, `ui/attachments.ts`, `ui/SuggestionList.tsx`
- IPC: `prompt:history`, `prompt:record`, `prompt:clear-history` (UI → main), `prompt:open` (main → UI, no payload) – `ipc.ts`
- Main: `register` in `main.ts` – File → Prompt… (Ctrl/Cmd+L), prompt history store
- Shared: `shared/classify.ts` (URL / command / query, no network), `shared/suggest.ts`, `shared/history.ts`

## Invariants
- `/…` is a command, `?…` a model query, URL-like text without attachments navigates, the rest goes to the model – `shared/classify.test.ts`
- URLs and commands never call the model – `e2e/prompt.spec.ts › a URL navigates without any model request`, `ui/Prompt.test.tsx`
- History is capped at 500, de-duplicated, never holds attachments or a key typed after `/key` – `shared/history.test.ts`, `main.test.ts`
- Escape closes suggestions, then stops a running assistant; it never hides the panel – `ui/Prompt.test.tsx`
- The panel shows itself for an approval or a skill save – `ui/AssistantPanel.test.tsx › shows itself…`
- The page area's size depends only on the window and the panels' widths, never on the conversation or the prompt – `e2e/prompt.spec.ts › a question runs the assistant…`
- Queries need an Anthropic key only for Claude models; the picker always shows the selected model, even when Ollama doesn't list it – `ui/Prompt.test.tsx › sends queries to an Ollama model…`, `› shows Ollama's error…`

## Dependencies
- Features: navigation (`navigation.go`, `toUrl`, state events via `window.antimony`), agent and skills (their `ipc.ts` types and bridges; their UI comes in as panel slots from `App.tsx`)
- App: `createJsonStore` (`src/app/main/json-store.ts`), `ctx.fileMenu` (ADR 0003)
- Stored data: `userData/prompt-history.json` (URLs, queries, commands; `/forget-history` clears it)

## Security surface
- IPC: the chrome UI reads and writes its own prompt history.
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd, copper-lantern-o7l4ma, still-meridian-r4v8nc · ADRs: 0003, 0004, 0005
