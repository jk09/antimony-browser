# Feature Specification: A configuration page listing every /command and skill with its script

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `/config` opens a configuration page with all system commands, built-in skills and macros, each with its steps |
| **Spec ID** | ember-console-k5w9tb |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-08 09:00 +00:00 |
| **Last updated** | 2026-10-08 12:19 +00:00 |
| **Affected features** | skills, prompt |
| **Target release** | 0.1.0 |
| **Related links** | specs violet-harbinger-p7w3kd, still-meridian-r4v8nc (macros); ADRs 0004, 0013 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** `/skills` prints one line per macro under the prompt; there is no place to see everything `/` can run, nor what a macro actually does (its tool calls).
- **Desired outcome:** `/config` opens a page over the page area listing every system entry (built-in prompt commands and built-in skills) and every user-defined macro, with its description, parameters and script (the steps it replays). Macros can be deleted there.

## 3. Background and Context

- **Current behavior:** Prompt commands (`promptCommands`, prompt feature) and skills (built-ins `/reload`, `/stop` and macros, skills feature) share the `/` namespace. Macros are created and changed only by the assistant (ADR 0013); the UI can list, delete and run them. `/skills` lists macros as text; `/forget` deletes one.
- **Motivation:** The user asked for a configuration page reachable via `/config` with an overview of all system and user-defined skills and their underlying scripts.

## 4. Goals

- Goal 1: `/config` (a system command) opens the configuration page; × or Escape closes it.
- Goal 2: Two sections: **System** (prompt commands with usage and description, then built-in skills with their step) and **Your macros** (name, parameters with hints, description, numbered steps as `tool { input }` with `{{params}}` highlighted).
- Goal 3: A macro can be deleted from the page (same path as `/forget`); the list follows `skills:list-changed`.

## 5. Non-Goals

- Non-goal 1: Creating or editing macros on the page (they stay assistant-made, ADR 0013).
- Non-goal 2: Changing settings (model, access switches) on the page.
- Non-goal 3: Running skills from the page.
- Non-goal 4: Claude Code's own `.claude/skills` (dev tooling, not the browser).

## 6. User Stories

- As a user, I want to see every `/command` the browser has, so I know what I can type.
- As a user, I want to see exactly which tool calls a macro replays before I run it.
- As a user, I want to remove a macro I no longer need while looking at it.

## 7. Functional Requirements

1. `/config` is a built-in prompt command (`usage: ''`, "Show all commands, skills and macros with their scripts"); its name is reserved, so no macro can be called `config`.
2. Running it asks main (`skills:request-config`) to open the page; main sends `skills:open-config` to the chrome UI, as Recall does.
3. The page lays over the page area (the page view is hidden while it is open, as on the Recall page), headed "Configuration", with a filter field that narrows all sections by name or description.
4. System section: each prompt command as `/name usage` + description (no script: "built into the browser"); each built-in skill as `/name` + description + its step(s).
5. Macros section: each macro as `/name <param>…` + description, each parameter with its hint, and its steps numbered, each as the tool name and its input as JSON; `{{param}}` placeholders are marked. Empty state: "No macros yet. Ask the assistant: “… and store it as /name”."
6. Each macro has a Delete button; it calls `skills.delete` and the list refreshes from `onListChanged`.

## 8. Non-Functional Requirements

- Performance: the list comes from the existing `skills:list`; no model request.
- Security: one new UI → main channel `skills:request-config` (no arguments) and one main → UI event `skills:open-config`; no new capability for web content or the model. Macro inputs are shown as text (React escapes them), never as HTML.
- Accessibility: page is a labelled region; sections are headings; Delete buttons name the macro; Escape closes.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: type `/config` → page opens over the page area → read, filter, delete a macro → × or Escape.
- Edge cases: no macros; filter matches nothing ("Nothing matches."); a macro deleted by the assistant while the page is open disappears.

## 10. Technical Notes

- Proposed approach: `skills/ui/ConfigView.tsx` mounted next to `RecallView` in `App.tsx`; imports `promptCommands` from `prompt/ipc.ts`. Skills IPC gains `requestConfig()` and `onOpenConfig()`. Prompt's `runCommand` handles `config`.
- Process split: UI and a trivial main relay.
- Dependencies: skills → prompt (`promptCommands`, already listed).
- Risks / unknowns: none.
- Open questions: none.

## 11. Acceptance Criteria

- [x] `/config` is a prompt command and calls `skills.requestConfig` – UI test (Prompt).
- [x] Main relays `skills:request-config` to `skills:open-config` – unit test.
- [x] The page lists every prompt command, the built-in skills with steps and macros with params, hints and steps – UI test.
- [x] The filter narrows the lists; Escape and × close the page – UI test.
- [x] Delete removes a macro through `skills.delete`; built-ins have no Delete – UI test.
- [x] A macro named `config` is rejected – unit test.

## 12. Testing / Verification

- Manual test plan: ask the assistant to store a macro with a parameter; type `/config`; check sections, filter and Delete.
- Automated test coverage: unit (skills main), UI (ConfigView, Prompt).
- Regression considerations: `/skills`, `/forget`, Recall page layout unchanged.

## 13. Rollout / Follow-up

- Rollout plan: ships enabled.
- Follow-up work: settings switches on the page; a File menu item.

## 14. Changes during implementation

Note any deviations from the original spec during implementation.

- End-to-end tests were not run in the cloud session (no Electron binary); CI runs them.
