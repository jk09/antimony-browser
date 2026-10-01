# Feature Specification: Ollama as a local model provider

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Ollama as a local model provider |
| **Spec ID** | copper-lantern-o7l4ma |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 01:45 +00:00 |
| **Last updated** | 2026-10-01 01:58 +00:00 |
| **Affected features** | agent, prompt |
| **Target release** | 0.1.0 |
| **Related links** | [violet-harbinger-p7w3kd](./violet-harbinger-p7w3kd.md) (LLM prompt bar), [ADR 0004](../adr/0004-let-an-llm-assistant-read-and-act-on-pages.md) ("revisit when more providers are added"), [Ollama Anthropic compatibility](https://github.com/ollama/ollama/blob/main/docs/api/anthropic-compatibility.mdx) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The assistant behind the prompt only works with Claude through the Anthropic API. That needs an API key and paid usage, and the prompts, and page content when page access is on, leave the machine.
- **Desired outcome:** Models served by a local [Ollama](https://ollama.com) show up in the prompt's model picker next to the Claude models. Picking one runs the same assistant with the same browser tools, approvals and debugger, free and without an API key. With the default setup, page data stays on the machine.

## 3. Background and Context

- **Current behavior:** `agent/main/anthropic.ts` calls `POST {ANTHROPIC_BASE_URL}/v1/messages` with a fixed list of three Claude models (`agent/ipc.ts › models`). A run refuses to start without an API key. The model picker and `/model` only know those three ids.
- **Motivation:** A free, locally hosted alternative for people without a key and for privacy-sensitive browsing.
- **Related issues or references:** Since v0.14 (2026-01-16) Ollama serves an Anthropic-compatible `POST /v1/messages`. It supports system prompts, multi-turn conversations, tools, `tool_use`/`tool_result`, base64 images and thinking blocks. `GET /api/tags` lists the installed models. ADR 0004 put the client behind `callModel` and said to revisit when more providers are added.

## 4. Goals

- Goal 1: Run the assistant on any installed Ollama model, with the existing run loop, tools, approvals and debugger unchanged.
- Goal 2: Pick Ollama models the same way as Claude models: the model picker and `/model`, filled from what Ollama has installed.
- Goal 3: Show clear errors when Ollama isn't running, the model is missing, or the model can't call tools.

## 5. Non-Goals

- Non-goal 1: Ollama's native `/api/chat` or the OpenAI-compatible endpoint. Ollama versions older than 0.14 are not supported.
- Non-goal 2: Changing the Ollama server address from the browser UI. It comes only from `OLLAMA_HOST` at launch.
- Non-goal 3: Pulling, deleting or configuring Ollama models from the browser. Context length, temperature and similar options are out of scope too.
- Non-goal 4: Other providers (OpenAI, Gemini, LM Studio…). The provider split should make them easy to add later.
- Non-goal 5: Different security tiers per provider. Ollama models get exactly the same page-access opt-in, approvals and refusals as Claude.

## 6. User Stories

- As a user without an Anthropic key, I want to choose `qwen3:8b (Ollama)` in the model picker and ask the browser to do things, so that I can use the assistant for free.
- As a privacy-minded user, I want page content I let the assistant read to go only to a model on my machine.
- As a user switching between providers, I want `/model` and the picker to list Claude and Ollama models together, so that switching takes one step.
- As a user whose Ollama isn't running, I want the prompt to tell me so in plain words instead of a raw network error.

## 7. Functional Requirements

1. **Model ids.** A model id is a Claude id (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-4-5`) or `ollama:<name>`, where `<name>` is an Ollama model name such as `qwen3:8b` or `library/llama3.2:latest` (`[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}`). Stored settings and `agent:update-settings` accept any well-formed `ollama:` id, even when that model isn't installed right now (Ollama may be offline at startup). Anything else is rejected as today.
2. **Model list.** A new IPC call `agent:models` (UI → main) returns `{ claude: ModelInfo[], ollama: { models: ModelInfo[] } | { error: string } }`. The Ollama part comes from `GET {ollamaUrl}/api/tags` with a 3 s timeout. A failure gives a short error such as "Ollama isn't running at http://localhost:11434." `ModelInfo` is `{ id, label }`. Ollama labels are `<name> (Ollama)`.
3. **Server address.** `ollamaUrl` defaults to `http://localhost:11434`. The `OLLAMA_HOST` environment variable overrides it, read once at startup in the main process. A value without a scheme gets `http://` (Ollama's own convention, e.g. `0.0.0.0:11434`), and the host `0.0.0.0` becomes `127.0.0.1`. Only `http:` and `https:` are accepted. Anything else logs a warning and falls back to the default. The renderer can't read or change the address.
4. **Requests to Ollama.** For an `ollama:` model, `callModel` posts to `{ollamaUrl}/v1/messages` with the same Messages API body. The model is the name without `ollama:`, and the body keeps `max_tokens`, `system`, `messages` and `tools`. It leaves out `cache_control`, `thinking`, `output_config`, `fallbacks`, the `anthropic-beta` header and `x-api-key`. Claude requests stay exactly as today.
5. **No key needed.** Runs on an Ollama model start without an Anthropic API key. The prompt's "No Anthropic API key yet" check, and the agent's own key check, apply only to Claude models. `AgentSettings` gets `provider: 'anthropic' | 'ollama'`, derived from the model, so the UI doesn't parse ids.
6. **Picker.** The prompt's model `<select>` shows two groups, "Claude" and "Ollama", filled from `agent:models`. It refreshes when the prompt opens and when the select gets focus. If Ollama reports an error, the Ollama group has one disabled option with that error. If the selected `ollama:` model isn't in the list, it still shows as an option, so the select never shows the wrong model.
7. **`/model`.** `/model <arg>` matches a Claude id or label, an `ollama:<name>` id, or a bare Ollama name from the current list. Suggestions for the first argument include the installed Ollama models (`ollama:<name>`), the same way `/forget` suggests skill names. If nothing matches, the error lists the available ids, or says Ollama isn't reachable.
8. **Errors.** Errors are worded for the provider of the run. For Ollama:
   - connection refused or timeout → "Couldn't reach Ollama at <url>. Is it running (`ollama serve`)?"
   - 404 or "not found" for the model → "Ollama has no model <name>. Pull it with `ollama pull <name>`."
   - an error saying the model doesn't support tools → "<name> can't use tools; pick a model with tool support (e.g. qwen3, llama3.1)."
   - anything else → "Ollama error <status>: <message>".
   The Claude messages stay as they are. The `refusal` notice says "The model declined this request." instead of naming Claude.
9. **Images.** Image attachments and screenshot tool results are sent as base64 image blocks, as for Claude. If Ollama rejects them because the model has no vision support, the run ends with Ollama's error message (requirement 8, "anything else"). The tools aren't changed per model.
10. **Debugger.** Request events show the provider and model (e.g. `Request 1 · ollama:qwen3:8b`). Nothing else in the debugger changes.
11. **Behavior unchanged for both providers:** system prompt, tool list, page-access tiers, approvals, sensitive-field refusal, `<untrusted_page_content>` markers, the 25-step limit, Stop, skills and "Save as skill".

## 8. Non-Functional Requirements

- Performance: `agent:models` never blocks the prompt. The picker shows the Claude models at once and adds the Ollama group when the call returns (at most 3 s). Local models can be slow; Stop still aborts the request.
- Reliability: Ollama being absent, stopped mid-run or returning malformed JSON ends the run with an error item and a debug `error` event. It never leaves a dangling `tool_use` or a stuck `running` state.
- Security: One new IPC channel, `agent:models`, which takes no arguments and returns ids and labels only. The server address is env-only (requirement 3), so the chrome UI can't redirect page content to another host. `secureWebPreferences` and the web-content sandbox are unchanged. A new ADR records the second provider and amends ADR 0004's "sent to Anthropic" consequence.
- Privacy: With an Ollama model, prompts, attachments, URL and title, and with page access page text and screenshots, go to `ollamaUrl` only (by default the local machine). Nothing new is stored except the chosen model id in `agent-settings.json`.
- Accessibility: The picker stays a native `<select>` with `<optgroup>`s. Error options are disabled and readable by screen readers.
- Platforms: Same on Windows, macOS and Linux. Ollama's default port is the same everywhere.

## 9. UX / UI Notes

- User flow: Ctrl/Cmd+L opens the prompt. Pick "qwen3:8b (Ollama)" in the model picker, or type `/model ollama:qwen3:8b`. Type a request; the assistant acts as with Claude.
- Visual considerations: The picker groups are "Claude" and "Ollama". There are no new controls.
- Edge cases: Ollama has no models installed → the Ollama group shows a disabled "No models installed (ollama pull <model>)". The saved model is `ollama:x` and Ollama is offline → it stays selected, and a run gives the "Couldn't reach Ollama" error. Switching models mid-conversation sends the existing history to the new model, as switching Claude models does today. Thinking blocks from Ollama have no signature, and Claude may reject that history: the error tells the user to start a `/new` conversation.

## 10. Technical Notes

- Proposed approach:
  - `agent/ipc.ts`: `claudeModels` (today's `models`); `ModelId = ClaudeModelId | \`ollama:${string}\``; `isOllamaModel`/`ollamaName` helpers; `ModelInfo`, `ModelList`, `AgentSettings.provider`; `channels.models`; `AgentApi.models()`.
  - `agent/main/anthropic.ts`: `buildRequest(request, provider)` and `createMessage(request, { provider, baseUrl, apiKey? … })`. For Ollama it sends the minimal body and no key or beta header. `describeError(error, provider, context)` gives the provider-specific wording.
  - `agent/main/ollama.ts` (new): `ollamaUrl(env)` parses `OLLAMA_HOST`, and `listOllamaModels(baseUrl, fetch, signal)` calls `/api/tags` and maps the names.
  - `agent/main/settings.ts`: `isModel` accepts well-formed `ollama:` ids. `get()` adds `provider`.
  - `agent/main/agent.ts`: replace the `hasKey()` dep with `missingSetup(): string | null`, which returns the "No Anthropic API key…" message only for Claude models. Neutral refusal notice.
  - `agent/main.ts`: route `callModel` by provider; register `agent:models`.
  - `prompt`: picker groups and refresh, provider-aware key check, `/model` matching and dynamic suggestions, `/model` description "Choose the model (Claude or Ollama)".
- Process split: Everything that talks to Ollama runs in the main process (fetch). Preload exposes `agent.models()`. The UI only gets ids, labels and error strings. Channel: `agent:models` (UI → main, invoke).
- Dependencies: No new npm packages (fetch, as for Anthropic). Requires Ollama ≥ 0.14 on the user's machine, which is not bundled. Features: prompt uses the agent's IPC types, as today.
- Risks / unknowns:
  - Small local models often call tools badly or not at all. The run loop already turns unknown tools and invalid input into error results, and the step limit bounds loops.
  - Ollama's compatibility layer may drop or reject images in `tool_result` blocks, or for some models (a known issue with cloud vision models). The model then answers without the screenshot, or the run reports Ollama's error.
  - Ollama's error body shape for the compatibility endpoint may differ from Anthropic's. Parse both `{error:{message}}` and `{error:"…"}`.
  - Thinking blocks from Ollama sent back to Claude after a switch (section 9).
- Open questions: none.

## 11. Acceptance Criteria

- [x] With an `ollama:` model selected, a run posts to `{ollamaUrl}/v1/messages` with `model` = the bare name, no `x-api-key`/`anthropic-beta` header and no `cache_control`/`thinking`/`output_config`/`fallbacks`, and Claude requests are unchanged (unit: `anthropic.test.ts`)
- [x] Runs on an Ollama model start and finish without an Anthropic key, and runs on Claude models without a key still fail with the `/key` message (unit: `agent.test.ts`, `Prompt.test.tsx`)
- [x] `OLLAMA_HOST` parsing: default, `0.0.0.0:11434` → `http://127.0.0.1:11434`, `https://host:1`, invalid → default (unit: `ollama.test.ts`)
- [x] `agent:models` returns the Claude list plus the installed Ollama models, or an Ollama error string when unreachable or timed out (unit: `ollama.test.ts`, `main.test.ts`)
- [x] Settings accept and persist well-formed `ollama:` ids and reject malformed ones; `provider` is derived (unit: `settings.test.ts`)
- [x] The picker shows the Claude and Ollama groups, the error or "no models" option, and keeps an unlisted selected `ollama:` model (unit: `Prompt.test.tsx`)
- [x] `/model` accepts `ollama:<name>` and bare installed names, suggests installed Ollama models, and reports unknown ones (unit: `commands`/`Prompt.test.tsx`)
- [x] Ollama errors (unreachable, missing model, no tool support, other) produce the sentences in requirement 8 (unit: `anthropic.test.ts`)
- [ ] End to end: with `OLLAMA_HOST` pointing at a fake server, picking the Ollama model and sending a request navigates via a tool call and shows the answer, with no API key set (e2e: `prompt.spec.ts`)
- [x] ADR added for the second provider; agent and prompt READMEs and `docs/features.md` updated

## 12. Testing / Verification

- Manual test plan: Install Ollama ≥ 0.14 and `ollama pull qwen3:8b`. Start Antimony with no Anthropic key. Pick the model and ask "open wikipedia and find the article on antimony". Approve actions with page access on. Then stop `ollama serve` and check the error and the picker's error option. Then check that Claude still works after `/key`.
- Automated test coverage: Vitest unit tests next to the code (above). Playwright e2e in `e2e/prompt.spec.ts` with a fake server that answers `/api/tags` and `/v1/messages`, extending the existing fake Anthropic server.
- Regression considerations: Claude request bodies byte-for-byte unchanged (existing `anthropic.test.ts`). Existing stored settings with Claude ids load unchanged. Skills replay without any model.

## 13. Rollout / Follow-up

- Rollout plan: Ships enabled, with no flag. Without Ollama installed, the only visible change is the Ollama group's "isn't running" option.
- Follow-up work: Native `/api/chat` for older Ollama or finer options (`num_ctx`). A UI setting for a remote Ollama host (needs its own security review). Other local or OpenAI-compatible providers. Marking models without tool or vision support in the picker using `/api/show` capabilities.

## 14. Changes during implementation

- Error wording (requirement 8): the missing-model sentence reads "Pull it with: ollama pull <name>" (no code formatting; the conversation shows plain text). An extra case was added: a 404 that isn't about a model, or a non-Messages reply, means Ollama is older than 0.14 → "Ollama at <url> doesn't speak the Messages API; update it to version 0.14 or newer." Without it, old Ollama versions would have been reported as "no model".
- The "No Anthropic API key" messages (prompt and agent) now add "or pick an Ollama model".
- `/model` asks main for a fresh model list each time instead of using the picker's cached one.
- The e2e criterion is written (`e2e/prompt.spec.ts › an installed Ollama model runs the assistant without an API key`) but couldn't run in the cloud session (no Electron binary); CI runs it.
