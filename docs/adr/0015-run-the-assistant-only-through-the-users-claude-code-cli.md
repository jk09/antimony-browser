# 0015. Run the assistant only through the user's Claude Code CLI, set up from a welcome page

- Status: Proposed
- Date: 2026-10-10
- Features: agent, prompt, welcome
- Spec: first-light-w5k8rd

## Context
The assistant had three backends: Claude through an Anthropic API key (ADR 0004: own `fetch` client and run loop, a `safeStorage`-encrypted key), local Ollama models (ADR 0005) and the user's Claude Code CLI (ADR 0009). Each brought its own model ids, errors, settings and setup steps, and the picker grouped all three, which confused new users who were never told what the assistant needs. The owner chose the Claude Code CLI as the only backend and asked for a first-launch page that sets it up.

## Options considered
1. **CLI only** – one setup path (install, log in) a welcome page can check end to end; no stored secret, no direct network client, one run path in `Agent`. Users without a Claude account, or who want a local model, lose the assistant.
2. **Keep all three, add the welcome page** – no one loses a backend, but the page has to explain and test three setups and the code keeps two run loops.
3. **CLI plus API key** – covers users with API credits but no Claude Code; keeps the secret store and the second loop.

## Decision
Option 1. Supersedes ADR 0005, and the API-key parts of ADR 0004 (the `fetch` client, the encrypted key) and ADR 0009 (`cli:` ids, switching between providers):
- Model ids are the Claude ids (`claude-haiku-4-5`, `claude-sonnet-5-5`, `claude-opus-5-5`); every run and `complete` goes through the CLI as in ADR 0009. Stored `cli:<id>` settings load as `<id>`, Ollama ids as Sonnet 5.5, a stored key is dropped.
- `/key`, `agent:set-key`, `agent:models`, `main/anthropic.ts`, `main/ollama.ts` and the API run loop are removed. The CLI's environment still drops `ANTHROPIC_*`.
- A `welcome` feature shows a setup page on a profile's first launch (and with `/welcome`, File → Welcome); `agent:check-cli` tells it whether the CLI starts, is logged in and answers a fixed one-line request with the selected model.
- The CLI is looked up for every use, so one installed while the browser runs is found without a restart.

## Consequences
- Prompts, attachments and, with page access, page content go only to Anthropic under the user's Claude Code account (ADR 0009). Nothing is sent to `api.anthropic.com` by Antimony itself or to `OLLAMA_HOST`.
- No API key is stored any more; the `safeStorage` dependency goes with it.
- Every request pays the CLI's start-up time; prompt caching and thinking summaries of the API path are gone.
- A local or other-provider model would need a new ADR.
