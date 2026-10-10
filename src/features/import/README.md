# import

Brings your Edge browsing data into Antimony: it reads the CSV file Edge's "Export browsing data" creates, adds its pages to history (searchable, in Recall and the map) and puts the pages you visited together into stacks, one per browsing session (visits less than 30 minutes apart). Start it from the Import step of the welcome page or by typing `/import-edge <path to the file>`; both make no model request.

## Entry points
- UI: `ui/ImportStep.tsx` – the welcome page's Import step (`importStep` slot filled in `App.tsx`): *Choose file…* opens the native dialog, then the result or the error is shown
- IPC: `import:choose|run` (UI → main) – `ipc.ts`; `run` takes only a path
- Skill: the built-in `/import-edge <file>` (skills' `builtins.ts`) replays the agent's `import_browsing_data` tool; the assistant may call the same tool when asked, with the user's approval each time
- Main: `register` in `main.ts` – the dialog, one import at a time, `provideImporter` for the agent; `main/run.ts` checks the path, reads the file and calls history's `importVisits` and stacks' `importStacks`
- Shared: `shared/edge-csv.ts` (CSV reader, column detection by header name, time formats, http(s) filter), `shared/sessions.ts` (30-minute session grouping)

## Invariants
- The header decides the columns (URL and a visit time are required; title optional); a file without them is rejected naming the columns found – `shared/edge-csv.test.ts`
- Rows with an unreadable address or time, or a non-http(s) address, are skipped and counted, never abort the import – `shared/edge-csv.test.ts`, `main/run.test.ts`
- Only an absolute `.csv` path (`~/` expanded, quotes stripped) of at most 50 MB and 200 000 rows is read; nothing is written for a file that can't be used – `main/run.test.ts`
- Sessions split at gaps over 30 minutes; a session with at least two pages becomes a stack, a single page only history – `shared/sessions.test.ts`, `main/run.test.ts`
- One import at a time; importing the same file again adds no visits and no stacks – `main.test.ts`, `../history/main/db.test.ts › importVisits`, `../stacks/main.test.ts › importStacks`
- The model gets a result line only, and a model-called import is approved every time – `../agent/main/agent.test.ts › import_browsing_data`

## Dependencies
- Features: agent (`provideImporter` from `main.ts`), history (`importVisits` from `main.ts`), stacks (`importStacks` from `main.ts`); welcome mounts `ImportStep` through a slot (it imports none of this code); skills lists the skill
- Electron: `dialog.showOpenDialog`
- Stored data: none of its own (history's `history.sqlite`, stacks' `stacks.json`)

## Security surface
- IPC: the chrome UI can open the file dialog and ask main to import a path; main reads that one `.csv` file and nothing else.
- Agent: the model can import a path the user gave, after the user's approval (ADR 0017); it never sees the file's content.
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: gentle-ferry-m3x7bq · ADRs: 0017
