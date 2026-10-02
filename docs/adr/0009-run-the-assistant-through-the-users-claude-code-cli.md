# 0009. Run the assistant through the user's Claude Code CLI, with browser tools over a per-run MCP server

- Status: Proposed
- Date: 2026-10-02
- Features: agent, prompt
- Spec: quartz-relay-c8m2vt

## Context
Claude in the assistant needs an Anthropic API key, which is billed separately from a Claude Code subscription. Users who already pay for Claude Code asked to use it. Antimony may not reuse the subscription's OAuth token in its own API requests. Driving the installed `claude` CLI as a subprocess is supported, and the CLI signs in with its own credentials. The CLI runs its own agent loop, though, so Antimony's tools, approvals and page-access tiers (ADR 0004) have to reach it from outside, and its own tools (shell, files, web) and the user's CLI setup must not reach page content.

## Options considered
1. **CLI loop, browser tools over a local MCP server** – the CLI's native tool use, with every call going through Antimony's `callTool` (approvals, refusals, page access). Needs a small MCP server (loopback HTTP) and a second run path in `Agent`.
2. **CLI as a bare model, tool calls parsed from its text** – keeps Antimony's loop. But it relies on a made-up text protocol, has no native tool results or images, and resends the history on every step.
3. **Claude Agent SDK** – a typed API over the same CLI. But it adds a shipped npm package and its own process handling for what amounts to a subprocess and a JSON stream.

## Decision
Option 1:
- Model ids are `cli:<claude id>`. The provider is `claude-cli`.
- Each run starts `claude -p` with stream-json in and out, `--system-prompt`, `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`, `--permission-prompts none`, `--allowedTools` limited to the offered `mcp__antimony__*` tools, `--max-turns 25` and `--resume` for later turns of a conversation.
- Main serves the tools from an MCP server written on `node:http` with no SDK. It listens on `127.0.0.1` with a random port, lives for one run, and requires the run's random bearer token. It refuses an `Origin` header or a foreign `Host`. Its URL and token reach the CLI in a 0600 temp file.
- The CLI's environment drops `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the nested Claude Code markers. The CLI path comes only from `CLAUDE_CLI_PATH` or a lookup, never from the UI.
- `complete` runs the CLI once without tools or a session.
- API/Ollama history and the CLI session aren't shared. Switching between them starts fresh, with a notice.

## Consequences
- With a `cli:` model, prompts, attachments, URL and title, and with page access page text and screenshots, go to Anthropic under the user's Claude Code account and its terms. Usage counts against their plan.
- The CLI saves these conversations in its own sessions folder (for `userData/claude-cli/`), outside Antimony's control.
- Each run and each `complete` pays the CLI's start-up time (about 1–2 s).
- Correctness depends on CLI flags and the stream-json format, which may change. Unknown events are ignored, and failures show the CLI's own message.
- Another local process of the same user could read the token from the temp file during a run. Such a process could already drive the browser in other ways.
- Streaming partial text, showing usage, and a settable CLI path would each be follow-ups.
