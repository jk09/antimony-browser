# agent – agent notes

- `shared/page-scripts.ts` functions are serialized with `toString()` and run in the page: keep each one self-contained (no imports, helpers or outer variables inside), JSON arguments only. `page-scripts.test.ts › scriptSource` checks this.
- Never run model-provided code in a page; add a fixed script instead.
- Keep the model history append-only (thinking blocks are bound to it): never edit or drop earlier messages; answer every `tool_use`.
- Keep `SYSTEM_PROMPT` and the tool list stable (prompt caching); per-turn state goes in the user message's `<browser_state>`.
- New page-reading tools are `kind: 'read'`, anything with side effects is `kind: 'action'` (approval).
- Ollama (`ollama:<name>`) shares the Messages API client: Anthropic-only request fields and headers (caching, thinking, effort, fallbacks, betas, the key) go only in the Claude branch of `buildRequest`/`createMessage`.
- `cli:` models never go through `createMessage`; the CLI owns their loop. Every tool the CLI calls must go through `Agent.callTool` (never execute tools in `mcp-server.ts`), and never pass Antimony's key or the user's CLI setup to the CLI (`cliEnv`, `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`).
