# 0005. Run the assistant on local Ollama models through its Anthropic-compatible API

- Status: Accepted
- Date: 2026-10-01
- Features: agent, prompt
- Spec: copper-lantern-o7l4ma

## Context
The assistant only worked with Claude, which needs an Anthropic API key and paid usage, and sends prompts and, with page access on, page content to Anthropic. Users asked for a free, locally hosted alternative. ADR 0004 put the model client behind `callModel` and said to revisit when more providers are added. Since 0.14 (January 2026) Ollama serves the Anthropic Messages API at `/v1/messages`, with tools, tool results, base64 images and thinking blocks.

## Options considered
1. **Ollama's Anthropic-compatible `/v1/messages`** – reuses the existing client, history format and run loop unchanged; needs Ollama ≥ 0.14, and its compatibility layer may drop images for some models.
2. **Ollama's native `/api/chat`** – works with older Ollama and gives full control over options and images, but needs a translation layer between Anthropic content blocks and Ollama messages to maintain and test.
3. **An LLM SDK covering many providers** – broadest reach, but a new shipped npm package and a larger surface for a single new provider.

## Decision
Option 1. Model ids `ollama:<name>` sit next to the Claude ids; `agent/main/anthropic.ts` sends Ollama a minimal request (no caching, thinking, effort, fallbacks, beta header or API key). The model picker lists installed models from `GET /api/tags` (3 s timeout) through a new argument-free `agent:models` IPC call. The server address comes only from `OLLAMA_HOST` at startup (default `http://localhost:11434`, http/https only); the chrome UI can't change it, so it can't redirect page content to another host. The security model of ADR 0004 applies unchanged to Ollama models: page-access opt-in, approvals, sensitive-field refusals, untrusted-content markers and the step limit.

## Consequences
- With an Ollama model, prompts, attachments, URL and title, and with page access page text and screenshots, go to `OLLAMA_HOST` (by default this machine) instead of Anthropic. ADR 0004's "sent to Anthropic" consequence holds for Claude models only.
- Small local models follow the system prompt and call tools less reliably; approvals remain the barrier for side effects, and prompt injection resistance is likely weaker than Claude's.
- Ollama older than 0.14 isn't supported; the error says to update. Thinking blocks from Ollama carry no signature, so switching a conversation from Ollama to Claude may need `/new`.
- A UI-settable or remote Ollama host, other OpenAI-compatible providers, or native `/api/chat` would each need their own decision.
