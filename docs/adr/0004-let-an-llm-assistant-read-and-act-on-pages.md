# 0004. Let an LLM assistant read and act on pages, Edge Copilot style

- Status: Accepted
- Date: 2026-09-30
- Features: agent, prompt, skills, navigation
- Spec: violet-harbinger-p7w3kd

## Context
The prompt sends requests that aren't URLs or commands to Claude, which controls the browser through tools. This is a new capability on top of the security baseline: page content leaves the machine, and something other than the user clicks and types in pages. Any page the model reads can try to instruct it (prompt injection), and the model's tool calls run with the user's cookies. The user asked for a security model like Microsoft Edge's Copilot Mode.

## Options considered
1. **Navigation only** – the model sees URL and title and can only navigate. Safe, but it can't answer questions about a page or do anything in it.
2. **Full control without confirmation** – read, click and type freely. Fast, but one injected instruction can act with the user's session.
3. **Edge-style tiers** – navigation without asking; page reading behind an opt-in page-access setting (off by default, visible in the prompt); page actions behind per-action approval ("Allow for this run" to skip repeats); visible acting state with Stop; page content marked as untrusted data; hard refusals for password and payment fields.

## Decision
Option 3. Details:
- Tools run in the main process. Page reading and element lookup are fixed scripts shipped with the app, run with `executeJavaScriptInIsolatedWorld` and JSON arguments, never model-written code. Clicks and keys are trusted `sendInputEvent`s; text uses `insertText`.
- Page text, titles and search results reach the model inside `<untrusted_page_content>` markers, and the system prompt says such content is data, never instructions.
- Once a run has read page content, navigating to another site (host without `www.`) needs approval too, so an injected instruction can't quietly carry page data out in a URL.
- A run stops after 25 model steps; Stop aborts the request and any pending approval.
- Skills replay recorded tool calls without the model; page steps need page access and one approval per replay.
- The Anthropic API is called with `fetch` (no SDK, so no new shipped npm package). The API key is stored encrypted with Electron `safeStorage` (session-only when the OS has no keyring) and never sent to the renderer; `ANTHROPIC_API_KEY` is the fallback.
- `secureWebPreferences` and the web content sandbox are unchanged: pages still get no preload, Node or IPC.

## Consequences
- Sent to Anthropic: prompts, attachments, URL and title; with page access on, page text and screenshots. Users control this with the page-access toggle.
- Remaining exfiltration paths after approval or on the same site (e.g. a same-site URL the page controls, or typing page data into a form the user approves) depend on the user reading approvals; the approval text shows the full URL or text.
- The untrusted-content markers reduce but don't prevent prompt injection; approvals are the actual barrier for side effects.
- CSS selectors in saved skills break when sites change; replays stop with a per-step error.
- Revisit when tabs arrive (tools must name a tab) or when more providers are added (the client sits behind `callModel`).
