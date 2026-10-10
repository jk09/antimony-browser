# agent – agent notes

- `shared/page-scripts.ts` functions are serialized with `toString()` and run in the page: keep each one self-contained (no imports, helpers or outer variables inside), JSON arguments only. `page-scripts.test.ts › scriptSource` checks this.
- Never run model-provided code in a page; add a fixed script instead.
- Keep `SYSTEM_PROMPT` and the tool list stable; per-turn state goes in the user message's `<browser_state>`.
- New page-reading tools are `kind: 'read'`, anything with side effects is `kind: 'action'` (approval). `kind: 'history'` needs no page access but must still set `flags.readPage`; gate with `needsPageAccess`, not `kind !== 'navigation'`.
- The CLI owns the model loop. Every tool the CLI calls must go through `Agent.callTool` (never execute tools in `mcp-server.ts`), and never pass an API key or the user's CLI setup to the CLI (`cliEnv`, `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`).
- `kind: 'stack'` tools act on stacks by name and never load a URL the model chose (that is why switching needs no approval); keep `close_stack` approved and out of macros.
- `kind: 'import'` tools read local files: the model-called form is always approved (never covered by `allowAll`), and the result goes back as one line, never the file's content (ADR 0017).
- Macros are data – replayable tool calls checked with `checkStep` – never code. `kind: 'macro'` tools touch neither the page nor the browser; keep their approval-after-reading rule (`steeredMacro`) when adding new ones.
- The CLI is the only backend (ADR 0015): don't add another model client or store an API key without a new ADR.
