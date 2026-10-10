# skills

Runs `/name` commands that replay browser tool calls without the model: macros the assistant stores when asked in the prompt ("open a new stack and store it as /ns", with `{{parameters}}` and a hint for each) and the built-in `/reload`, `/stop` and `/import-edge [file]` (imports an Edge export through the agent's `import_browsing_data`; without a path a file dialog opens); `/config` opens a configuration page listing every system command, built-in skill and macro with the steps it replays. Arguments are typed after the command, constants or `@stack` / `@stack/page` references (resolved to the page's URL by the prompt).

## Entry points
- IPC: `skills:list|delete|run|request-config` (UI → main), `skills:list-changed|open-config` (main → UI) – `ipc.ts`; there is no channel to create or change a macro
- UI: `ui/ConfigView.tsx` (mounted next to Recall in `App.tsx`) – the configuration page over the page area (the page view is hidden meanwhile): a filter, System (prompt commands, built-in skills with their step) and Your macros (parameters with hints, numbered steps with `{{params}}` marked, Delete); × or Escape closes it
- Main: `register` in `main.ts` – macro store, `provideMacros` (the agent's `save_macro`, `list_macros`, `delete_macro`), argument binding, replay through the agent
- Shared: `shared/params.ts` (names, `{{params}}`, argument parsing, `argumentHint` for the prompt's faint hint), `shared/builtins.ts`

## Invariants
- Macros are created and changed only through the assistant's tools – `main.test.ts › lists the built-in skills and offers no way to save from the UI`
- Steps are replayable tools whose inputs pass the tool's schema; every `{{param}}` is declared and every param used; names can't shadow commands or built-ins – `main.test.ts › rejects invalid and reserved names…`
- The configuration page only reads and deletes macros; built-ins have no Delete – `ui/ConfigView.test.tsx`
- Macros stored without `params` load with parameters from their steps and no hints – `main.test.ts › loads macros stored without params…`
- The last parameter takes the rest of the line; missing arguments run nothing – `shared/params.test.ts`, `main.test.ts › runs a macro…`
- `/import-edge` takes the rest of the line as the path (spaces kept), or none (the import then opens a file dialog), and runs the one-step `import_browsing_data` replay with no approval, as it is the user's own command; `file` is an optional parameter (`[file]`, built-in skills only – a macro can't declare one) – `main.test.ts › runs /import-edge…`, `shared/params.test.ts › lets an optional parameter…`
- Replays make no model request, need page access for page steps, ask one approval for any page actions, and stop at the first failing step – `../agent/main/agent.test.ts › Agent.replay`, `e2e/prompt.spec.ts`

## Dependencies
- Features: agent (`replay`, `checkStep`, `provideMacros` from `main.ts`), prompt (`promptCommands` from `ipc.ts`: reserved names, the configuration page's System list)
- App: `createJsonStore` (`src/app/main/json-store.ts`)
- Stored data: `userData/skills.json` (`{ skills: [{ name, description, params: [{ name, hint }], steps }] }`)

## Security surface
- IPC: the chrome UI can list, delete and run macros and ask main to open the configuration page (no arguments); runs go through the agent's checks (page access, approval, sensitive fields).
- Agent: the model can save, list and delete macros; after reading page or history content in a run, saving or deleting needs approval (ADR 0013).
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd, still-meridian-r4v8nc, glass-meridian-f5y2nq, spoken-macro-m4q7zt, ember-console-k5w9tb, gentle-ferry-m3x7bq, tidy-compass-k7r2vb · ADRs: 0004, 0013, 0017, 0018
