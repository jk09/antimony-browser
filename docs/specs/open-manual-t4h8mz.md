# Feature Specification: Self-describing browser tools, history and stack tools, and `/help`

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Tool registry: every assistant tool is declared once with structured metadata (summary, arguments with descriptions, returns, permissions, examples) that generates both what the model receives and a `--help`-style listing; features contribute their own tools (first: `history_search`, `stack_list`, `stack_open`); `/help` and a `help` tool print the listing |
| **Spec ID** | open-manual-t4h8mz |
| **Status** | Draft <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-02 19:55 +00:00 |
| **Last updated** | 2026-10-02 19:55 +00:00 |
| **Affected features** | agent, history, stacks, prompt |
| **Target release** | 0.1.0 |
| **Related links** | [violet-harbinger-p7w3kd](./violet-harbinger-p7w3kd.md) (assistant), [ember-ledger-h3x8vq](./ember-ledger-h3x8vq.md) (history), [branching-trail-k4w9zp](./branching-trail-k4w9zp.md) (stacks), [quartz-relay-c8m2vt](./quartz-relay-c8m2vt.md) (CLI provider), ADR 0004, ADR 0006, ADR 0008 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The assistant's 13 tools are hard-coded in `agent/main/tools.ts` with one-line descriptions and bare argument schemas (no per-argument descriptions, no return format, no examples). Browser features such as history and stacks have no tools at all, so a request like "open my three most recent history pages, each in its own stack" can't be carried out. Nobody can ask the browser which tools it supports and get a precise answer. The debugger shows only tool names, which makes it look as if the model gets nothing more.
- **Desired outcome:** Each tool is declared once in the feature that owns it, as a structured `ToolSpec`. From that one declaration Antimony generates (a) the description and JSON schema sent to the model (API, Ollama and the CLI's MCP server alike), (b) a `--help`-style listing and per-tool detail, shown by `/help` without the model and returned by a `help` tool when the user asks in plain language, and (c) the argument validation. History and stacks contribute `history_search`, `stack_list` and `stack_open`.

## 3. Background and Context

- **Current behavior:** `toolsFor(pageAccess)` returns `ToolDefinition`s with `name`, `kind`, `replayable`, `description`, `input_schema`. `agent.ts` sends `description` and `input_schema` to the model but stores only the tool names in the debug log. `validateInput` knows `string` and `boolean` (with enums). `executeTool` is one switch over all tools. `/page-access` gates `read` and `action` tools; `action` tools need approval; after a `read` tool, navigating to another site needs approval (ADR 0004).
- **Motivation:** The model uses a tool well when its description says when to use it, what each argument means, what comes back and shows an example, so the model doesn't have to guess from the name. Generating all of that from one structured declaration keeps descriptions consistent, testable and in sync with validation and help, and lets features add tools without editing the agent.
- **Related issues or references:** Anthropic tool-use guidance (detailed descriptions, per-property descriptions, examples); MCP `tools/list` carries the same `description` and `inputSchema`.

## 4. Goals

- Goal 1: One declaration per tool drives the model's tool definition, validation, `/help` and the `help` tool; nothing about a tool is written twice.
- Goal 2: Features register their own tools from their `register`; the agent owns the run loop, permissions and approvals for all of them.
- Goal 3: The model can find pages in history (with filters) and open URLs in new stacks, so multi-step requests across history and stacks work.
- Goal 4: `/help` and `/help <name>` answer "what can the browser do" like a CLI's `--help`, without a model call.

## 5. Non-Goals

- Non-goal 1: Closing, renaming or switching stacks from the model (only listing and opening), and editing or deleting history or notes.
- Non-goal 2: Letting users or web pages define new tools at runtime; the registry is filled at startup from feature code only.
- Non-goal 3: Changing the approval rules of ADR 0004 or the page-access tiers.
- Non-goal 4: Per-tool help in other languages.

## 6. User Stories

- As a user, I want to type "open the 3 most recent pages from my history, each in its own stack" and have the assistant search history and open each one in a new stack.
- As a user, I want `/help` to list every tool, command and skill with its arguments, and `/help history_search` to show the full usage, like `--help` in a terminal.
- As a user, I want to ask "what browser tools do you support?" and get the same listing from the assistant.
- As a developer, I want to add a tool to my feature by declaring it in my feature folder, and see the exact definition sent to the model in the debugger.

## 7. Functional Requirements

1. **ToolSpec.** A tool is declared as `ToolSpec` in `agent/ipc.ts`-free shared types (`agent/shared/tool-spec.ts`, no runtime imports beyond pure code) with:
   - `name` (`snake_case`, unique; tools from features other than agent/navigation are prefixed with the feature: `history_`, `stack_`),
   - `group` (`navigation`, `page`, `actions`, `history`, `stacks`, `help`; orders the help listing),
   - `kind` (`navigation` | `read` | `action`, unchanged meaning),
   - `replayable`,
   - `summary` (one line, ≤ 80 characters, imperative),
   - `details` (optional: when to use it, what not to use it for),
   - `params`: ordered list of `{ name, type: 'string'|'boolean'|'integer', description, required, enum?, min?, max?, maxLength?, default? }`,
   - `returns` (what the result text contains),
   - `examples`: 1–3 `{ input, explanation }`,
   - and a main-process `run(input, ctx)` handler kept outside the shared spec.
2. **Model definition.** `toModelTool(spec)` produces `{ name, description, input_schema }`. The description is, in this order and only from the spec: summary; details; `Returns: …`; `Requires: …` (page access / the user's approval / nothing, derived from `kind`); `Example: name {json} – explanation` per example. The schema has every param with `type`, `description`, `enum`, `minimum`/`maximum`, `maxLength`, `default`, the `required` list and `additionalProperties: false`. Output is deterministic (same specs → byte-identical tools) so prompt caching holds.
3. **Same tools everywhere.** The API, Ollama and Claude Code CLI paths (MCP `tools/list`) all get `toModelTool` output from the same `toolsFor(pageAccess)`; tool order is fixed (registration order, grouped).
4. **Validation from the spec.** `validateInput` checks unknown/missing args, types (`integer` = safe integer), enums, `min`/`max`, `maxLength` (default 10 000) and returns the input with defaults applied. Every error names the tool and argument.
5. **Registry.** `agent/main.ts` exports `registerTools(specs)`; features call it in `register`. Duplicate names throw at startup. Registration after the first run starts throws (the tool list must stay stable). The 13 existing tools become specs in agent with the same names, kinds and behavior, and richer descriptions.
6. **`history_search`** (history; kind `read`, not replayable). Params: `query` (string, ≤ 500; words from title, URL, text or note; empty or missing lists the most recent pages), `mode` (`text`|`semantic`, default `text`; semantic uses the selected model as the history view's Meaning search does), `bookmarked` (boolean, default false; only pages with a note), `since` (string, ISO 8601 date or date-time; only pages last visited at or after it), `limit` (integer 1–50, default 10). Returns one line per page, most recent first for an empty query, else by relevance: `[n] <title> – <url> · last visited <ISO time> · <k> visits[ · note: …]`, titles and notes inside `<untrusted_page_content>`; plus any search notice (e.g. semantic fell back to text). Zero results say so.
7. **`stack_list`** (stacks; kind `read`, not replayable). Param: `name` (optional string). Without it: every open stack, most recently used first, as `@<name> – <root title> · <n> pages[ (current)]`. With it: that stack's outline (the same outline `@name` attaches today). Unknown name → error listing the names. Titles inside `<untrusted_page_content>`.
8. **`stack_open`** (stacks; kind `navigation`, replayable). Param: `url` (string, required; http(s) URL or host). Opens a new stack (as the + button does), loads the URL in it, waits for it to load (same timeout as `navigate`), makes it current and returns its name and the page state. A non-web address is an error and creates no stack. The ADR 0004 rule applies: after a `read` tool in the run (including `history_search`), opening a page on another site than the current page needs approval like `navigate`. Respects the 50-stack limit (error when full).
9. **The agent follows the current stack.** After `stack_open`, `get_page_state`, page tools and `navigate` act on the new current stack's tab.
10. **`help` tool** (group `help`; kind `navigation`, not replayable). Param: `name` (optional string). Returns the same text as `/help` / `/help <name>` (requirement 12) for the tools offered in this run (tools hidden by page access are listed as unavailable with how to enable them). The system prompt says: when the user asks what the browser or assistant can do, call `help` and show its output unchanged.
11. **Help text format** (`agent/shared/help.ts`, pure): overview = header with page-access state, then per group a heading with its requirement (`Page (needs page access)`, `Actions (needs page access and your approval)`), one line per tool `  <usage>  <summary>` aligned in columns, where usage is `name <required> [optional]` and enum params show `--mode=text|semantic`; then `Commands` (built-in `/commands` from `promptCommands`) and `Skills` (saved and built-in), and a last line `Run /help <tool or command> for details.` Detail = `name – summary`, `Usage:` line, details, `Arguments:` table (name, type, default, range/enum, description), `Returns:`, `Requires:`, `Examples:`. Unknown name → `No tool, command or skill named <x>.` plus close matches.
12. **`/help` command** (prompt). `/help` shows the overview and `/help <name>` the detail (accepts `history_search`, `/history`, `history`). The text appears in the assistant panel's conversation as a local, monospaced block; it is not sent to the model and not part of the model history. No model call. Suggestions offer tool, command and skill names as the argument.
13. **IPC for help.** New `agent:tools` (UI → main) returns `ToolHelp[]` (the specs without `run`, plus whether each is currently available) so the UI formats `/help` with the same `help.ts`. No arguments.
14. **Debugger.** Each logged model request records the full tool definitions sent (`name`, `description`, `input_schema`). The panel keeps the names as the summary line; expanding it shows each definition as formatted JSON. Identical tool lists across requests in a run are stored once and referenced.

## 8. Non-Functional Requirements

- Performance: building tool definitions happens once per page-access value and is cached; `history_search` text mode answers in < 100 ms on 100 000 pages (existing FTS and index paths); `/help` renders without IPC beyond one `agent:tools` call.
- Reliability: a tool handler that throws reaches the model as an error result (as today); a stack that fails to load still exists and is reported with the load error.
- Security: no new web-content capability; tools run in main only, through `Agent.callTool` (page access, approvals, refusals). `agent:tools` returns static metadata only. Feature tools get only what their handler closes over; they never get the browser port of another feature unless passed explicitly. `stack_open` URLs are checked like `navigate` (http/https only). New ADR records that the assistant may read browsing history and stacks when page access is on.
- Privacy: with page access on, `history_search` and `stack_list` send titles, URLs, visit times and notes of matching pages to the selected model (Anthropic, the CLI, or local Ollama); `semantic` mode also sends candidates as Meaning search does (ADR 0006). With page access off these tools are neither offered nor runnable. The debugger shows this data only in memory, as today.
- Accessibility: the `/help` block is selectable text with a heading per group; the debugger's expandable rows are buttons with `aria-expanded`.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: type `/help` → overview in the conversation; `/help stack_open` → detail. Ask "open my 3 latest history pages each in its own stack" → the assistant calls `history_search {"limit": 3}`, then `stack_open` three times (approval for each cross-site open, or Allow for this run), and answers with the three stack names.
- Visual considerations: monospaced block, aligned columns, wraps at the panel width without horizontal scroll (long summaries wrap under their column).
- Edge cases: page access off (history and stack tools listed as unavailable with `/page-access on`); empty history (`No pages in history.`); the current page is the most recent history item (the model decides; the tool doesn't hide it); 50-stack limit; `stack_open` while a stack is being cycled with Ctrl+Tab (cycle is cancelled as with the + button).

## 10. Technical Notes

- Proposed approach:
  - `agent/shared/tool-spec.ts`: `ToolSpec` (serializable part), `toModelTool`, `usageLine`; `agent/shared/help.ts`: `formatOverview`, `formatDetail`. Both pure, unit-tested.
  - `agent/main/tools.ts`: `MainTool = ToolSpec & { run(input, ctx): Promise<ToolOutput> }`; the registry (`registerTools`, `toolNamed`, `toolsFor`); `validateInput` from params; the 13 existing tools rewritten as `MainTool`s whose `run` holds today's switch branches; `describeCall` becomes an optional `describe(input, element?)` on the spec with today's texts.
  - `ToolContext` passed to `run`: the `BrowserPort` for the current tab (looked up per call, so `stack_open` switching tabs is followed), `untrusted`, `formatState`, and the run's `signal`.
  - `history/tools.ts` (main): `history_search` over `HistoryDb` (adds a `since` filter and a `limit` to the existing search/recent queries); registered in history's `register`.
  - `stacks/tools.ts` (main): `stack_list`, `stack_open` reusing `openNewStack`, the outline builder and `getTabs`; registered in stacks' `register`.
  - `help` tool in agent; it formats with `help.ts` from the registry and the prompt's command list passed in at registration by prompt (`registerHelpSources`) so agent doesn't import prompt.
  - Prompt: `/help` in `promptCommands` and `runCommand`; result adds a local item to the conversation via a new `agent:local-note` path or a prompt-owned item (decide in implementation; must not enter the model history).
  - Debug log: store `tools` definitions per request.
- Process split: specs and help formatting in `shared/` (main and UI); handlers in main; `/help` formatting in the renderer from `agent:tools`. New channel `agent:tools` (UI → main, no args).
- Dependencies: history and stacks import `registerTools` and the `MainTool` type from `agent/main.ts` (listed in their READMEs); stacks already depends on agent types. No npm packages.
- Risks / unknowns: registration order across features must be deterministic (features register in the fixed order of `src/app/main/features.ts`); `pageBrowser` currently wraps one `PageControls` – verify `getPage()` returns the active tab's controls and switch to a per-call lookup if not; Ollama models may handle the longer descriptions less well (measure the token cost; descriptions stay ≤ ~120 words each).
- Open questions: none blocking.

## 11. Acceptance Criteria

- [ ] Every tool the model gets is generated from a `ToolSpec`: description contains summary, Returns, Requires and at least one Example; every schema property has a description – `tool-spec.test.ts`, `tools.test.ts`.
- [ ] Generated tool definitions are deterministic across calls and identical for the API, Ollama and MCP paths – `tool-spec.test.ts`, `mcp-server.test.ts` / `claude-cli.test.ts`.
- [ ] `validateInput` enforces integer, min/max, enum, maxLength and applies defaults; errors name tool and argument – `tools.test.ts`.
- [ ] Registering a duplicate name or registering after the first run throws – `tools.test.ts`.
- [ ] The 13 existing tools keep their names, kinds, approvals and behavior – existing `agent.test.ts` and e2e pass unchanged.
- [ ] `history_search` filters by query, mode, bookmarked, since and limit, orders as specified, wraps titles and notes as untrusted, and is neither offered nor runnable without page access – `history/tools.test.ts`, `agent.test.ts`.
- [ ] `stack_list` lists stacks (current marked) and a named stack's outline; unknown names list the valid ones – `stacks/tools.test.ts`.
- [ ] `stack_open` creates a stack, loads the URL, makes it current; later page tools act on it; non-web addresses create nothing; after a read, a cross-site open needs approval – `stacks/tools.test.ts`, `agent.test.ts`.
- [ ] With a fake model, "open the 2 most recent history pages each in its own stack" runs `history_search` then two `stack_open`s and ends with three stacks – `agent.test.ts` (fake model script), `e2e/prompt.spec.ts`.
- [ ] `/help` shows grouped tools with usage lines, commands and skills, and marks page tools unavailable when page access is off; `/help history_search` shows usage, arguments, returns, requires and examples; unknown names suggest close matches; no model request is made – `help.test.ts`, `Prompt.test.tsx`.
- [ ] The `help` tool returns the same text as `/help` for the same state – `help.test.ts`, `tools.test.ts`.
- [ ] The debugger shows the full definitions sent with each request, collapsed by default – `DebugPanel.test.tsx`.
- [ ] ADR 0010 records history and stack access for the assistant; agent, history, stacks and prompt READMEs and `docs/features.md` updated.

## 12. Testing / Verification

- Manual test plan: with page access on, visit three sites, ask "open my 3 most recent history pages each in its own stack", allow; check three new stacks. Ask "what browser tools do you support?" and compare with `/help`. Open the debugger and expand the tool list of a request. Turn page access off and repeat `/help`.
- Automated test coverage: unit tests for spec → model tool, help formatting, validation, registry, each new tool against fakes; agent loop test with a scripted fake model; e2e in `e2e/prompt.spec.ts` for `/help` and one history → stack run with the local fake model server.
- Regression considerations: prompt caching (tool list stable within and across runs); skills replay (`stack_open` replayable, `history_search` not); CLI MCP path lists the same tools.

## 13. Rollout / Follow-up

- Rollout plan: ships unflagged; it changes only what the assistant can do with page access on and adds `/help`.
- Follow-up work: `stack_switch` / `stack_close` (with approval), `history_note`, tools from `menu` (run a menu item); `/help` search across descriptions; generating `docs/tools.md` from the registry.

## 14. Changes during implementation

