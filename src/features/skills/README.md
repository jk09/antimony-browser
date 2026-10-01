# skills

Turns an assistant run into a `/command` that replays the same browser tool calls without the model, optionally with `{{parameters}}` typed after the command; `/back`, `/forward`, `/reload` and `/stop` ship as built-in skills.

## Entry points
- UI: `ui/SaveSkill.tsx` – mounted in the assistant panel above the prompt (`App.tsx`), opened by `/save` or "Save as skill"
- IPC: `skills:list|draft|save|delete|run|request-save` (UI → main), `skills:list-changed`, `skills:save-requested` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – skill store, argument binding, replay through the agent
- Shared: `shared/params.ts` (names, `{{params}}`, argument parsing), `shared/builtins.ts`

## Invariants
- Only replayable tools (navigation and page actions) can be saved; names can't shadow commands or built-ins – `main.test.ts › rejects invalid and reserved names…`
- The last parameter takes the rest of the line; missing arguments run nothing – `shared/params.test.ts`, `main.test.ts › runs a skill…`
- Replays make no model request, need page access for page steps, ask one approval for any page actions, and stop at the first failing step – `../agent/main/agent.test.ts › Agent.replay`, `e2e/prompt.spec.ts`

## Dependencies
- Features: agent (`replay`, `savableSteps`, `isReplayableTool` from `main.ts`), prompt (`promptCommands` from `ipc.ts`, reserved names)
- App: `createJsonStore` (`src/app/main/json-store.ts`)
- Stored data: `userData/skills.json` (`{ skills: [{ name, description, steps }] }`)

## Security surface
- IPC: the chrome UI can save and run skills; runs go through the agent's checks (page access, approval, sensitive fields).
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd, still-meridian-r4v8nc · ADRs: 0004
