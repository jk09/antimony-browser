# 0017. Import browsing data from a file the user names, grouped into stacks by session

- Status: Accepted (the grouping by session is superseded by 0018)
- Date: 2026-10-10
- Features: import, history, stacks, agent, skills, welcome
- Spec: gentle-ferry-m3x7bq

## Context
People switching from Edge start with no history and no stacks. Edge's "Export browsing data" creates a CSV file. Antimony could read Edge's profile directory or database directly, or take only the file the user exports. Importing also adds a tool that reads a local file, which the assistant (and a prompt-injected page) could try to point at other files.

## Options considered
1. **Read Edge's profile database** – no export step, but needs filesystem access to another application's data, handles locked databases and several Edge versions, and reads far more than the user chose to hand over.
2. **Import the exported CSV the user names** – one explicit file, no access to other data, a small parser; the user does the export.
3. **A model that reads the file** – flexible about formats, but sends browsing data to the model for no gain.

## Decision
Option 2, parsed in code (no package, no model). `import_browsing_data` is a replayable agent tool of its own kind, `import`: it needs no page access and no browser. When the model calls it, the user is asked to approve it every time ("Allow for this run" doesn't cover it); when the user types the built-in skill `/import-edge <file>`, the typed command is the request and nothing is asked. Only `.csv` files up to 50 MB are read; the model gets one result line, never the file's content. Pages go into history through `importVisits` (all or nothing, once per canonical URL and time), and visits less than 30 minutes apart form a stack through `importStacks`: unopened, behind the user's own stacks, never the current one, at most 50 stacks in all.

## Consequences
- The file's content never leaves the machine; the model sees only the path it was given and the result line.
- A macro that includes `import_browsing_data` imports without asking when typed, like any macro step; macros are saved only by the assistant and saving after untrusted content needs approval (ADR 0013).
- Grouping by time is deterministic and can mix unrelated pages opened in one sitting; topic grouping would need the model and is left out.
- Imported history has no dwell time, text, screenshot or summary until a page is visited again.
- Other browsers' formats can be added behind the same tool with another parser.
