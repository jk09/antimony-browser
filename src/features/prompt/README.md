# prompt

The browser's location bar, shaped like the Claude prompt: Ctrl/Cmd+L opens it, a URL loads the page, `/command` runs a command or skill, and anything else is a request for the assistant. It suggests past URLs, questions, commands and skill arguments, and takes pasted images and long text as attachments.

## Entry points
- UI: `ui/Prompt.tsx` – mounted in the toolbar (`App.tsx`), collapsed to a bar with the page title and URL; `ui/commands.ts` built-in commands, `ui/attachments.ts`, `ui/SuggestionList.tsx`
- IPC: `prompt:history`, `prompt:record`, `prompt:clear-history` (UI → main), `prompt:open` (main → UI, no payload) – `ipc.ts`
- Main: `register` in `main.ts` – File → Prompt… (Ctrl/Cmd+L), prompt history store
- Shared: `shared/classify.ts` (URL / command / query, no network), `shared/suggest.ts`, `shared/history.ts`

## Invariants
- `/…` is a command, `?…` a model query, URL-like text without attachments navigates, the rest goes to the model – `shared/classify.test.ts`
- URLs and commands never call the model – `e2e/prompt.spec.ts › a URL navigates without any model request`, `ui/Prompt.test.tsx`
- History is capped at 500, de-duplicated, never holds attachments or a key typed after `/key` – `shared/history.test.ts`, `main.test.ts`
- Escape closes suggestions, then stops a running assistant, then collapses the prompt – `ui/Prompt.test.tsx`
- The card stays open while an approval is pending – `ui/Prompt.test.tsx › opens by itself…`

## Dependencies
- Features: navigation (`navigation.go`, `toUrl`, state events via `window.antimony`), agent and skills (their `ipc.ts` types and bridges)
- App: `createJsonStore` (`src/app/main/json-store.ts`), `ctx.fileMenu` (ADR 0003)
- Stored data: `userData/prompt-history.json` (URLs, queries, commands; `/forget-history` clears it)

## Security surface
- IPC: the chrome UI reads and writes its own prompt history.
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd · ADRs: 0003, 0004
