# Feature Specification: Macros created by the assistant from the prompt

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Macros created by the assistant from the prompt |
| **Spec ID** | spoken-macro-m4q7zt |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude (for Jozef Kosik) |
| **Owner** | Jozef Kosik |
| **Reviewers** | Jozef Kosik |
| **Created on** | 2026-10-05 10:00 +00:00 |
| **Last updated** | 2026-10-05 19:55 +00:00 |
| **Affected features** | skills, agent, prompt, stacks |
| **Target release** | |
| **Related links** | PR #44, violet-harbinger-p7w3kd (skills, "Save as skill"), still-meridian-r4v8nc, glass-meridian-f5y2nq; ADR 0004, ADR 0013 |

## 2. Summary

- **Problem statement:** A skill (`/name`) can only be made by running a request and then saving the run's recorded tool calls through a form (`/save`, "Save as skill"). The user can't simply tell the assistant "open a new stack and store that as /myskill", can't give parameters hints, and the assistant's prompt isn't tuned for driving the browser interactively.
- **Desired outcome:** Macros are created, changed and deleted only by asking the assistant in the prompt. The assistant writes the macro's script (a list of browser tool calls with `{{parameters}}`) and stores it; typing `/myskill args` then runs it at once, without the model. Arguments are constants or `@` references to stacks and pages, with `@` suggestions; while typing a macro the prompt shows a faint hint of the arguments still to type.

## 3. Background and Context

- **Current behavior:** skills feature: `/save` and the "Save as skill" button open `SaveSkill`, a form over the last run's replayable steps where `{{name}}` in an argument makes a parameter; `skills:draft|save|request-save` IPC; `skills.json`. Replays run through `Agent.replay` (page access, one approval for page actions). There is no tool to open a new stack.
- **Motivation:** Interactive browser control from one prompt: "do X and store it as /x" should be one request; recurring actions become one word.
- **Related issues or references:** ADR 0004 (assistant acts on pages; skills replay recorded calls), agent `CLAUDE.md` ("Never run model-provided code in a page").

## 4. Goals

- Goal 1: The assistant can save, list and delete macros with tools (`save_macro`, `list_macros`, `delete_macro`), from requests like "open a new stack and store the action as macro /myskill" or "delete the macro /myskill".
- Goal 2: Macros take parameters declared in the request, each with a hint; `/myskill` alone (or with arguments) runs it immediately; a faint hint shows the arguments still missing.
- Goal 3: Arguments can be `@stack` / `@stack/page` references, suggested as you type and resolved to the page's address when the macro runs.
- Goal 4: No other way to create macros remains (form, `/save`, "Save as skill", `skills:save` IPC).
- Goal 5: The system prompt is tuned for interactive browser control (act directly, keep the user informed, macros).

## 5. Non-Goals

- Non-goal 1: Arbitrary JavaScript macros. A macro's script is a list of the browser's own tool calls (JSON), validated and replayed by the agent. Model-written code never runs in a page or in the app (agent `CLAUDE.md`, ADR 0013).
- Non-goal 2: Control flow (loops, conditions) or reading values inside a macro.
- Non-goal 3: Renaming the `skills` feature folder or the `/skills` and `/forget` commands.

## 6. User Stories

- As a user, I want to say "open a new stack and store the action as macro /myskill" so that typing `/myskill` later opens a new stack at once.
- As a user, I want to say "search wikipedia for something and store it as /wiki with the search term as parameter" so that `/wiki electron` searches without the model.
- As a user, I want `/open-in @news/front` to use the page I reference with `@`.
- As a user, I want to see what a macro expects while I type it.
- As a user, I want to say "delete the macro /myskill" and have it gone.

## 7. Functional Requirements

1. Agent tools of a new kind `macro` (no page access needed, not replayable): `save_macro { name, description, params: [{ name, hint }], steps: [{ tool, input }] }` (creates or replaces), `list_macros {}` (names, descriptions, parameters and steps), `delete_macro { name }`. The skills feature provides them to the agent (`provideMacros`).
2. Steps may only use replayable tools (`navigate`, `go_back`, `go_forward`, `reload`, `stop`, `new_stack`, `click`, `type_text`, `press_key`, `scroll`); each step's input must pass the tool's schema; string inputs may hold `{{param}}` placeholders. Every placeholder must be declared in `params` and every declared param used; names follow the existing rules (no built-in command or built-in skill names). Up to 50 steps, 10 params, hints up to 80 characters.
3. `save_macro` and `delete_macro` need the user's approval (Allow / Allow for this run) when page or history content was read earlier in the run (it could have steered them); otherwise they run directly. The conversation shows what was saved or deleted.
4. Each user message's `<browser_state>` lists the saved macros (`/name <param> …`), so the model can refer to them; the system prompt explains macros and how to build them.
5. A new replayable navigation tool `new_stack { url? }` opens a new stack (like Ctrl/Cmd+N) and, with `url`, loads it there. Stacks provides it to the agent (`provideStackOpener`).
6. Typing `/name args` for a macro runs it immediately (unchanged replay rules: page access for page steps, one approval for page actions, stop at the first failing step). Text that only mentions a macro (`delete the macro /myskill`) goes to the model.
7. Arguments: split as before (quotes group words, the last parameter takes the rest of the line). An argument token `@stack` or `@stack/ref` naming a known stack or page is replaced by that page's URL (a stack's current page) before the run; unknown `@words` stay text.
8. While the input is `/name …` for a macro with parameters, `@` suggests stacks and pages for the argument being typed, and a faint hint after the text shows the parameters still to type, as `<name: hint>`.
9. Removed: `SaveSkill` form, `/save`, "Save as skill", `skills:draft`, `skills:save`, `skills:request-save`, `skills:save-requested`, agent `savableSteps` (state field and export).
10. Stored data: `skills.json` entries gain `params: [{ name, hint }]`; entries without it (saved by earlier versions) get their parameters from the steps with empty hints.

## 8. Non-Functional Requirements

- Performance: no extra model requests; hints and `@` resolution are local.
- Reliability: invalid stored entries are dropped by the existing store fallback rules (unchanged).
- Security: no new IPC channels; three IPC channels removed. Macros are data (tool calls) validated on save and again on replay; replays keep page access and approval rules. Saving after reading untrusted content needs approval.
- Privacy: macros stay in `userData/skills.json`; the list of macro signatures is sent to the selected model in each request.
- Accessibility: the hint is `aria-hidden`; the textarea gets an `aria-description` with the same hint.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: "open a new stack and store the action as macro /myskill" → the assistant calls `new_stack`, then `save_macro` → "Saved /myskill". Typing `/my` suggests `/myskill`; Enter runs it.
- Visual considerations: the hint uses the placeholder colour, inline after the typed text, in the same font.
- Edge cases: macro named like a built-in → the tool returns an error the model reads; deleting an unknown macro → error; a hint never shows for built-in commands.

## 10. Technical Notes

- Proposed approach: `MacroPort` and `StackOpener` interfaces in agent `main/tools.ts`; skills and stacks provide them from their `register`. `validateInput` learns `array` and `object` property types (deep checks in skills' `parseDraft`). `Skill.params` becomes `{ name, hint }[]`.
- Process split: main only for tools and storage; the hint, `@` suggestions and `@` resolution in the prompt UI (`shared/suggest.ts`, `skills/shared/params.ts`).
- Dependencies: skills → agent (`provideMacros`, `replay`, `checkStep`), stacks → agent (`provideStackOpener`), prompt → skills/stacks types.
- Risks / unknowns: models may write brittle selectors; the system prompt asks for stable ones.
- Open questions: none.

## 11. Acceptance Criteria

- [x] `save_macro` stores a macro with params and hints; it appears in `skills.list()` and runs with `/name args` without a model request.
- [x] `save_macro` rejects unknown or read-only tools, invalid step inputs, undeclared or unused params and reserved names, with an error the model reads.
- [x] `save_macro` / `delete_macro` ask for approval after a page or history read in the same run, and not otherwise.
- [x] `list_macros` returns the saved macros; `delete_macro` removes one; built-ins can't be deleted.
- [x] `<browser_state>` lists saved macros.
- [x] `new_stack` opens a new stack (optionally at a URL) and is replayable.
- [x] `@stack` / `@stack/ref` arguments resolve to URLs; unknown `@words` stay text.
- [x] Typing `/macro ` shows the faint hint of the missing parameters, and `@` suggests stacks and pages there.
- [x] `/save`, "Save as skill", the save form and the save IPC are gone.
- [x] Old `skills.json` entries without `params` still load.

## 12. Testing / Verification

- Manual test plan: with a model, "open a new stack and store the action as macro /ns"; type `/ns`; "store a macro /wiki that searches Wikipedia for a term"; `/wiki electron`; `/wiki @stack`; "delete the macro /ns".
- Automated test coverage: unit – `agent/main/tools.test.ts`, `agent/main/agent.test.ts`, `skills/main.test.ts`, `skills/shared/params.test.ts`, `prompt/shared/suggest.test.ts`, `prompt/ui/Prompt.test.tsx`; e2e – `e2e/prompt.spec.ts` (the fake model saves a macro, then it replays).
- Regression considerations: built-in skills `/reload`, `/stop`; `@` navigation outside commands.

## 13. Rollout / Follow-up

- Rollout plan: ships unflagged.
- Follow-up work: editing a macro's steps by hand is intentionally not offered; ask the assistant.

## 14. Changes during implementation

- The spec was set Active without a separate approval round: the request itself described the feature in detail.
- The `AssistantPanel` `form` slot was removed with the save form (nothing else used it).
- `new_stack` needed no stacks IPC; stacks provides its existing Ctrl/Cmd+N action to the agent.
- e2e (`e2e/prompt.spec.ts`) was updated but not run in the cloud session (no Electron binary); CI runs it.
