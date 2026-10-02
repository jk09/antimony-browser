# Feature Specification: Run the assistant through the Claude Code CLI

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Claude Code CLI provider: run the assistant through the user's installed `claude` CLI (their own Claude Code login), next to the Claude API key and Ollama providers, switchable in the model picker and with `/model` |
| **Spec ID** | quartz-relay-c8m2vt |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-02 18:50 +00:00 |
| **Last updated** | 2026-10-02 21:25 +00:00 |
| **Affected features** | agent, prompt |
| **Target release** | 0.1.0 |
| **Related links** | [violet-harbinger-p7w3kd](./violet-harbinger-p7w3kd.md) (assistant), [copper-lantern-o7l4ma](./copper-lantern-o7l4ma.md) (Ollama), ADR 0004, ADR 0005 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The assistant uses Claude only through an Anthropic API key, which is billed separately from a Claude Code subscription. Reusing the subscription's OAuth token in Antimony's own API requests isn't allowed. Users who already have Claude Code installed and signed in have no way to use it.
- **Desired outcome:** A third provider, **Claude Code CLI**. Antimony starts the user's installed `claude` CLI as a subprocess in print mode. The CLI signs in with its own credentials, and Antimony never reads or handles them. The browser tools reach the CLI through a local MCP server that lives in Antimony's main process, and approvals, page-access rules and refusals stay in Antimony. The user switches between Claude (API key), Claude Code CLI and Ollama in the model picker or with `/model`.

## 3. Background and Context

- **Current behavior:** `agent/main.ts` sends every model step to `createMessage` (Messages API over fetch) with the stored API key, or to Ollama's `/v1/messages`. The `Agent` loop in `main/agent.ts` owns the model history, runs the tools, asks for approvals and enforces the 25-step limit. The picker has two groups, Claude and Ollama.
- **Motivation:** The user asked for this so their Claude Code subscription can run the assistant. Anthropic supports driving the CLI as a subprocess. Extracting its token is not supported.
- **Related issues or references:** CLI flags used here (checked with `claude --help`, version 2.1.x): `-p`, `--input-format stream-json`, `--output-format stream-json`, `--verbose`, `--model`, `--effort`, `--system-prompt`, `--tools ""`, `--mcp-config`, `--strict-mcp-config`, `--allowedTools`, `--permission-prompts none`, `--setting-sources`, `--max-turns`, `--resume`, `--no-session-persistence`; also `claude auth status --json` (`{ loggedIn, authMethod, … }`).

## 4. Goals

- Goal 1: The assistant runs on a Claude model through the user's `claude` CLI, with the same tools, approvals, page-access tiers, refusals and step limit as the API provider.
- Goal 2: The user can switch between the three providers in the picker and with `/model`. The API-key and Ollama providers keep working unchanged.
- Goal 3: `complete` (history summaries, Meaning search) also works when a CLI model is selected.

## 5. Non-Goals

- Non-goal 1: Reading, copying or forwarding the CLI's OAuth token or credentials, or calling the API with them.
- Non-goal 2: Installing the CLI, or logging in or out from inside Antimony. The user does that in a terminal.
- Non-goal 3: The CLI's own tools (Bash, file editing, web fetch…), the user's CLI settings, hooks, plugins, skills or MCP servers. All of these are switched off for the assistant.
- Non-goal 4: Carrying the model's memory of a conversation across a switch between the CLI and the other providers (see FR 9).
- Non-goal 5: Showing streamed text token by token. Whole assistant messages are shown as they arrive.

## 6. User Stories

- As a Claude Code subscriber, I want the browser assistant to run on my subscription so that I don't need a separate API key.
- As a user, I want to pick "Sonnet 5.5 (Claude Code)" in the model picker, or type `/model cli:claude-sonnet-5-5`, and switch back to the API or Ollama the same way.
- As a user, I want the same approval prompts whichever provider runs the assistant.

## 7. Functional Requirements

1. **Model ids.** The CLI models are `cli:<claude model id>` for each entry in `claudeModels` (`cli:claude-sonnet-5-5`, `cli:claude-opus-5-5`, `cli:claude-haiku-4-5`), labelled "<label> (Claude Code)". The provider is `'claude-cli'`. `providerOf`, `isModelId` and the settings validation accept them, and they are stored in `agent-settings.json` like other ids.
2. **Model list.** `agent:models` returns a third group, `cli: { models } | { error }`. It runs `<cli> auth status --json` with a 5 s timeout. If the CLI can't be started, the error reads "Claude Code CLI not found. Install it, or set CLAUDE_CLI_PATH." If it answers `loggedIn: false`, the error reads "Claude Code isn't logged in. Run `claude` in a terminal and log in." Otherwise the group lists the three models.
3. **CLI location.** The CLI is `CLAUDE_CLI_PATH` if set, otherwise `claude` looked up on `PATH`. It is read at startup only and the UI can't change it. It is started with `spawn` (no shell) and an argument list.
4. **Picker and `/model`.** The picker shows three groups: "Claude (API key)", "Claude Code CLI" and "Ollama". A group's error shows as a disabled option, as Ollama's does today. `/model` accepts the CLI ids and labels and suggests the CLI ids. The "no API key" check before a run applies only to the `anthropic` provider.
5. **Run.** A run with a CLI model starts one CLI process. The process has:
   - flags `-p --input-format stream-json --output-format stream-json --verbose`;
   - `--model <claude id>`, plus `--effort medium` for Sonnet 5.5 and Opus 5.5;
   - `--system-prompt <SYSTEM_PROMPT>`;
   - `--tools ""`, `--setting-sources ""` and `--strict-mcp-config`;
   - `--mcp-config <file>`, a temporary file readable only by the user and deleted when the run ends;
   - `--allowedTools` listing the offered `mcp__antimony__<tool>` names;
   - `--permission-prompts none` and `--max-turns 25`;
   - `--resume <session id>` after the first CLI run of the conversation.

   The working directory is `userData/claude-cli/` (empty, so no `CLAUDE.md` is picked up). The user message (`<browser_state>`, attachments, text) is written to stdin as one stream-json user message, and stdin is then closed.
6. **Tools over MCP.** For each CLI run, main starts an MCP server (streamable HTTP, JSON responses, no SSE) on `127.0.0.1` with a random port and a random 32-byte bearer token. It handles `initialize`, `notifications/*`, `ping`, `tools/list` and `tools/call`.
   - `tools/list` returns `toolsFor(pageAccess)`.
   - `tools/call` goes through the same path as an API tool call: validation, page access, sensitive-field refusal, approval with "Allow for this run", the cross-site rule, execution, conversation items, debug events and savable steps. The result comes back as MCP content (text, and a JPEG image for screenshots), with `isError` for errors and denials.
   - The server rejects a wrong or missing token (401) and a request with an `Origin` header or a `Host` other than its own address (403). It also rejects any other method or path. It closes when the run ends.
7. **Output.** stream-json events from stdout become:
   - `assistant` messages: their text joined into an assistant item, and a `response` debug event;
   - `system`/`init`: a `request` debug event (model, tools, session id);
   - `result`: the end of the run. `subtype: error_max_turns` adds "Stopped after 25 steps.", and `is_error` becomes an error item with the result text.

   A non-zero exit without a `result` becomes an error item with the last lines of stderr (at most 500 characters). An auth failure ("not logged in", "/login", "401") becomes "Claude Code isn't logged in. Run `claude` in a terminal and log in."
8. **Stop.** Stop kills the process (SIGTERM, then SIGKILL after 2 s). A pending approval resolves as stopped and an MCP call in flight returns an error. The run then ends with "Stopped." as today.
9. **Conversation.** The CLI keeps the conversation in its session. Antimony keeps only the session id (from `system`/`init`) and resumes it on the next CLI run. `/new` forgets the id. The two sides don't share memory:
   - the first run on a CLI model after messages with an API or Ollama model starts a fresh CLI session;
   - the first API or Ollama run after a CLI run starts with an empty model history.

   In both cases a notice says "The model doesn't see the earlier messages (provider changed)." Switching between the API and Ollama works as today.
10. **Session files.** Sessions are saved by the CLI under its projects folder for `userData/claude-cli/`, so `--resume` works. `/new` doesn't delete them.
11. **`complete`** with a CLI model runs the CLI once with `--tools "" --no-session-persistence --max-turns 1 --output-format json --input-format stream-json`, the given system prompt and an optional JPEG, and no MCP server. It returns the result text, or rejects with the same messages as FR 7. Callers' timeouts and abort signals kill the process.
12. **Environment.** The child process gets Antimony's environment without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`, so the CLI uses its own login and not Antimony's key settings. Antimony's stored API key is never passed to the CLI.

## 8. Non-Functional Requirements

- Performance: The CLI's start-up time (about 1–2 s) is added to each run and each `complete`. The model list's auth check runs when the prompt opens, as Ollama's does.
- Reliability: A missing CLI, logged-out CLI, crash, malformed output line (skipped and logged) or killed process ends the run with an error item. The app never hangs. A run also ends if the CLI exits while an approval is open.
- Security:
  - No new capability for web content. The chrome UI can't set the CLI path or any CLI argument; it can only pick one of the fixed `cli:` ids.
  - The MCP server listens on loopback only, lives for one run, and needs a fresh token. It rejects browser-originated requests (Origin/Host checks, against DNS rebinding).
  - Built-in CLI tools and the user's CLI settings, hooks and MCP servers are off (`--tools ""`, `--setting-sources ""`, `--strict-mcp-config`), so a page-injected instruction can't reach a shell or files. `--permission-prompts none` denies anything not in `--allowedTools`.
  - An ADR records the decision and the new outbound path (prompts and page content go to Anthropic through the CLI, under the user's Claude Code account).
- Privacy:
  - With a CLI model, prompts, attachments, URL and title, and with page access page text and screenshots, go to Anthropic through the CLI under the user's Claude Code account and its terms.
  - The CLI stores the conversation in its session files on disk (FR 10). The README states this.
- Accessibility: No new controls. The picker groups are `optgroup`s with labels.
- Platforms: Windows resolves `claude.cmd`/`claude.exe` on `PATH`; `spawn` uses `shell: false` (on Windows the `.cmd` shim needs `shell: true`, so on Windows `CLAUDE_CLI_PATH` should point at `claude.exe` and the lookup prefers it).

## 9. UX / UI Notes

- User flow: Open the picker, choose "Sonnet 5.5" under "Claude Code CLI" and type a request. Approvals and tool lines appear as with the API. `/model claude-sonnet-5-5` switches back to the API-key provider.
- Visual considerations: Only the picker's group labels change: "Claude" becomes "Claude (API key)", and a "Claude Code CLI" group is added.
- Edge cases:
  - The CLI isn't installed or isn't logged in: the group shows the reason, and a run shows the same message.
  - The CLI is selected but the list fails at run time: the run error says why.
  - Page access is turned on mid-conversation: the next run's `tools/list` offers the page tools.
  - Several tool calls in one turn: the CLI calls them one at a time and each waits for its approval.

## 10. Technical Notes

- Proposed approach:
  - `ipc.ts`: `cli:` ids, `Provider` adds `'claude-cli'`, `isCliModel`, `cliModelId`, and `ModelList.cli`.
  - `main/claude-cli.ts`: argument building, spawn, NDJSON parsing into typed events, kill, and `complete`. The spawn function is injected for tests.
  - `main/mcp-server.ts`: a minimal MCP streamable-HTTP server over `node:http`, with no SDK.
  - `Agent` gains a second run path, `runExternal`, used when `providerOf(model) === 'claude-cli'`. It reuses `callTool` for MCP calls, and `userContent`, `ask`, `debug`, `fail`, `begin` and `end`. `AgentDeps` gains `runCli(…)`, which `main.ts` wires to the spawn and the MCP server.
  - `settings.ts` accepts the new ids. `Prompt.tsx` and `commands.ts` get the third group.
- Process split: main – CLI process, MCP server, run path; prompt UI – picker group, `/model`, key check.
- Dependencies: The user's Claude Code CLI, a version that supports the flags listed in §3. No new npm package (MCP is implemented on `node:http`).
- Risks / unknowns:
  - CLI flags and the stream-json format may change between CLI versions. Parsing is tolerant: unknown events are ignored and logged to the debug panel.
  - The terms for using a subscription this way are Anthropic's to set. The README links to Claude Code's docs and says usage counts against the user's plan.
  - Without an Electron binary in the cloud session, the e2e test runs only in CI.
- Open questions: –

## 11. Acceptance Criteria

- [x] The picker shows "Claude (API key)", "Claude Code CLI" and "Ollama" groups, and `/model` accepts and suggests `cli:` ids; choosing one stores it.
- [x] Model list: CLI not found and logged-out CLI each show their message in the CLI group; a logged-in CLI lists three models.
- [x] A CLI run spawns the CLI with the flags of FR 5 (no shell; no `ANTHROPIC_API_KEY` in its environment) and sends the user message as stream-json.
- [x] MCP server: `initialize`, `tools/list` (page tools only with page access), `tools/call`; a bad token gives 401, and an `Origin` header or a foreign `Host` gives 403.
- [x] A CLI tool call that acts on the page waits for approval, and Deny reaches the CLI as an error result; sensitive-field typing is refused.
- [x] Assistant text from the CLI shows as assistant items; `error_max_turns`, `is_error`, a crash and a logged-out CLI each show an error item.
- [x] Stop kills the process and ends the run, also while an approval is open.
- [x] The second CLI run of a conversation passes `--resume <session id>`; `/new` and a provider change start fresh with the notice.
- [x] `complete` works with a CLI model (text, and text plus JPEG).
- [x] The API-key and Ollama providers behave as before (existing tests pass).
- [x] An ADR records the CLI provider, and the agent README lists the new surface.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan:
  1. With `claude` logged in, pick Sonnet 5.5 (Claude Code CLI) and ask "open example.com and tell me the heading" with page access on.
  2. Try an approval, then Deny.
  3. Press Stop mid-run.
  4. Use `/new`.
  5. Switch to the API key and back.
  6. Log the CLI out and check the message.
  7. Rename the CLI and check the "not found" message.
- Automated test coverage (unit):
  - `main/claude-cli.test.ts`: arguments, environment, stream parsing, errors, kill, `complete`.
  - `main/mcp-server.test.ts`: protocol, auth, origin and host checks.
  - `main/agent.test.ts`: the CLI run path with a fake CLI (approval, deny, stop, resume, provider switch).
  - `main.test.ts`: model list with the CLI group, `complete` with a CLI model.
  - `settings.test.ts`: the new ids.
  - Prompt UI: picker groups and `/model`.
- e2e: a fake `claude` script (Node) via `CLAUDE_CLI_PATH` that answers `auth status` and replays a run calling `navigate` over MCP – `e2e/prompt.spec.ts`.
- Regression considerations: API-key and Ollama runs, `complete` for history, skills replay, debug panel.

## 13. Rollout / Follow-up

- Rollout plan: Ships enabled, no flag. The CLI group only lists models when a logged-in CLI is found.
- Follow-up work:
  - Streamed partial text (`--include-partial-messages`).
  - Showing CLI usage and cost in the debug panel.
  - A setting for the CLI path.

## 14. Changes during implementation

- The CLI also gets `--disable-slash-commands`, because `--setting-sources ""` still loads the user's skills. Its environment also drops `CLAUDECODE` and `CLAUDE_CODE_SESSION_ID`, so an Antimony started from a Claude Code shell doesn't join that session. It sets `MCP_TOOL_TIMEOUT` to 24 h, because an approval may wait longer than the CLI's default tool timeout.
- `complete` uses `--output-format stream-json` (the same parser as runs) instead of `json`.
- Without `CLAUDE_CLI_PATH`, the CLI is looked up on `PATH` and then in its install folders (`~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`), because apps started from the macOS Dock get a minimal `PATH`.
- If the model is switched to a CLI model during an API/Ollama run, the run ends with "The model was switched to the Claude Code CLI. Send the request again."
- The debug panel shows a CLI turn as a `request` (content, tools, resume id), then `response` events for "CLI started" (MCP server status), each assistant message and the result (without usage).
- `e2e/fixtures/fake-claude.mjs` (a real MCP client) stands in for the CLI in `main.test.ts` and `e2e/prompt.spec.ts`. The e2e test wasn't run locally because the cloud session has no Electron binary; CI runs it. The real CLI (2.1.x) was checked by hand: the MCP server connected, `navigate` was called and answered, and `--resume` kept the conversation.
- ADR 0009 is drafted as Proposed.

