# import

Brings your Edge browsing data into Antimony: it reads the CSV file Edge's "Export browsing data" creates, adds its pages to history (searchable, in Recall and the map) and groups its pages into at most 30 stacks by how related their addresses are (site, then path) and, when the Claude CLI works, by topic. Start it from the Import step of the welcome page or by typing `/import-edge [path to the file]`; without a path a file dialog opens.

## Entry points
- UI: `ui/ImportStep.tsx` – the welcome page's Import step (`importStep` slot filled in `App.tsx`): *Choose file…* opens the native dialog, then the result or the error is shown
- IPC: `import:choose|run` (UI → main) – `ipc.ts`; `run` takes only a path
- Skill: the built-in `/import-edge [file]` (skills' `builtins.ts`, `file` optional) replays the agent's `import_browsing_data` tool (`path` optional: none opens the dialog; cancelling ends quietly); the assistant may call the same tool when asked, with the user's approval each time
- Main: `register` in `main.ts` – the dialog, one import at a time, `provideImporter` for the agent; `main/run.ts` checks the path, reads the file, groups, calls history's `importVisits` and stacks' `importStacks`; `main/topics.ts` the model request, its answer's validation and merge
- Shared: `shared/edge-csv.ts` (CSV reader, column detection by header name, time formats, http(s) filter), `shared/grouping.ts` (pages, site and path groups, leftover placement by shared words, chain order)

## Invariants
- The header decides the columns (URL and a visit time are required; title optional); a file without them is rejected naming the columns found – `shared/edge-csv.test.ts`
- Rows with an unreadable address or time, or a non-http(s) address, are skipped and counted, never abort the import – `shared/edge-csv.test.ts`, `main/run.test.ts`
- Only an absolute `.csv` path (`~/` expanded, quotes stripped) of at most 50 MB and 200 000 rows is read; nothing is written for a file that can't be used – `main/run.test.ts`
- Pages group by registrable domain (a site over 60 pages splits by first path part); the 30 largest groups of two or more pages become stacks, single pages join a group sharing two distinctive words or stay in history – `shared/grouping.test.ts`, `main/run.test.ts`
- The model sees only titles and `host/path` of the groups' samples and up to 300 single pages; its answer is checked (unknown/repeated ids, tiny stacks, > 30 stacks) and any failure falls back to the addresses – `main/topics.test.ts`, `main/run.test.ts`
- One import at a time; importing the same file again adds no visits and no stacks – `main.test.ts`, `../history/main/db.test.ts › importVisits`, `../stacks/main.test.ts › importStacks`
- The assistant's tool gets a result line only, and a model-called import is approved every time – `../agent/main/agent.test.ts › import_browsing_data`
- No path opens the dialog; cancelling imports nothing – `main.test.ts › opens the file dialog…`

## Dependencies
- Features: agent (`provideImporter`, `complete` from `main.ts`), history (`importVisits` from `main.ts`), stacks (`importStacks` from `main.ts`); welcome mounts `ImportStep` through a slot (it imports none of this code); skills lists the skill
- Electron: `dialog.showOpenDialog`
- Stored data: none of its own (history's `history.sqlite`, stacks' `stacks.json`)

## Security surface
- IPC: the chrome UI can open the file dialog and ask main to import a path; main reads that one `.csv` file and nothing else.
- Agent: the model can import a path the user gave, after the user's approval (ADR 0017); it never sees the file's content.
- Model: an import sends the selected model, through the CLI, the group labels and sample titles and up to 300 single pages' titles and `host/path` (no query string or fragment), once per import (ADR 0018); the welcome step says so.
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: gentle-ferry-m3x7bq, tidy-compass-k7r2vb · ADRs: 0017, 0018
