# Feature Specification: /history-access setting

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `/history-access on\|off` turns the assistant's `search_history` tool on or off |
| **Spec ID** | quiet-ledger-t9m4rx |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-04 19:40 +00:00 |
| **Last updated** | 2026-10-04 20:00 +00:00 |
| **Affected features** | agent, prompt |
| **Target release** | 0.1.0 |
| **Related links** | spec patient-archive-h6q2wn, ADR 0012 (follow-up it names), PR #39, PR #40 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Since ADR 0012 the assistant can always search browsing history, even with page access off; users who want their history kept from the model have no way to say so.
- **Desired outcome:** A persistent agent setting, `historyAccess` (default on), switched with `/history-access on|off`.

## 3. Background and Context

- **Current behavior:** `search_history` (tool kind `history`) is offered in every run.
- **Motivation:** The user asked for an off switch; ADR 0012 lists it as the follow-up.
- **Related issues or references:** `/page-access` (same pattern).

## 4. Goals

- One command to keep the assistant out of history, remembered across restarts.

## 5. Non-Goals

- A toggle button in the prompt card (only `/page-access` has one).
- Limiting what the history panel or Recall send to the model (they act on the user's own request).

## 6. User Stories

- As a user, I want to type `/history-access off` so that the assistant can't look into my browsing history.

## 7. Functional Requirements

1. `AgentSettings.historyAccess: boolean`, stored in `agent-settings.json`; missing or invalid stored values mean on; `agent:update-settings` accepts `{ historyAccess: boolean }` and rejects other types.
2. While off, `search_history` isn't offered to the model (API, Ollama and CLI tool lists) and a call to it is refused with `History access is off; the user has to turn it on (/history-access on).`
3. Each user turn's `<browser_state>` says `History access: on|off`; the system prompt tells the model the tool doesn't work while it's off.
4. `/history-access on|off` changes it and confirms; `/history-access` alone shows the current value. The command is suggested like `/page-access`.

## 8. Non-Functional Requirements

- Security: the existing `agent:update-settings` channel gets one more validated boolean.
- Privacy: off → no history data reaches the model through the assistant.
- Accessibility / Platforms: no new UI; all platforms.

## 9. UX / UI Notes

- `/history-access off` → "History access off: the assistant can't search your browsing history."

## 10. Technical Notes

- `toolsFor({ pageAccess, historyAccess })`; check in `Agent.callTool` next to the page access check.
- Changing the setting changes the tool list (prompt cache miss once, as with page access).

## 11. Acceptance Criteria

- [x] Settings default, repair and update validation – `agent/main/settings.test.ts`.
- [x] Tool list without history access – `agent/main/tools.test.ts`.
- [x] Run with history access off: tool not offered, call refused, state says off – `agent/main/agent.test.ts`.
- [x] `/history-access off` updates the setting and confirms – `prompt/ui/Prompt.test.tsx`.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual: `/history-access off`, ask "search history for LLM" → the assistant says history access is off; `/history-access on` → it searches.
- Automated: unit tests above.

## 13. Rollout / Follow-up

- No flag. Follow-up: a toggle in the prompt card if it's used often.

## 14. Changes during implementation

- None in behaviour. Started on the user's direct request, so the spec went straight to Active. `npm run test:e2e` not run in the cloud session (no Electron binary); CI runs it.
