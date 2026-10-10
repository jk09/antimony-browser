# Feature Specification: Welcome page that sets up the Claude Code CLI; Claude Code CLI as the only assistant backend

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | A welcome page walks new users through setup (Claude Code CLI installed? does it answer? model strength, how to use the prompt and skills); the API-key and Ollama backends are removed, so the assistant runs only through the Claude Code CLI |
| **Spec ID** | first-light-w5k8rd |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-10 09:00 +00:00 |
| **Last updated** | 2026-10-10 10:00 +00:00 |
| **Affected features** | welcome (new), agent, prompt, skills |
| **Target release** | 0.1.0 |
| **Related links** | ADRs 0004, 0005, 0009; specs quartz-relay-c8m2vt (Claude Code CLI), copper-lantern-o7l4ma (Ollama) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** A new user starts on an empty browser with an assistant panel and no idea that the assistant needs a model backend, how to pick one, or what the prompt and `/` commands can do. Three backends (Anthropic API key, Claude Code CLI, Ollama) make setup and the model picker confusing.
- **Desired outcome:** On first launch a welcome page asks whether the Claude Code CLI is installed (with install steps if not), tests that it answers, lets the user pick the model strength, and explains the prompt and skills. The assistant runs only through the Claude Code CLI; the model picker offers just Haiku, Sonnet and Opus.

## 3. Background and Context

- **Current behavior:** The agent supports Claude through an API key (`/key`, `ANTHROPIC_API_KEY`, own model loop in `main/agent.ts`, client `main/anthropic.ts`), Claude through the user's Claude Code CLI (`cli:<id>`, ADR 0009) and Ollama (`ollama:<name>`, ADR 0005). The model picker has three groups. Nothing guides a first-time user.
- **Motivation:** The owner asked for a setup landing page and for the Claude Code CLI to be the only backend.

## 4. Goals

- Goal 1: A welcome page shown in the page area on first launch and on demand (`/welcome`).
- Goal 2: It checks the CLI in steps (found → logged in → answers a tiny request) and shows the result and the time the answer took.
- Goal 3: Remove the API-key and Ollama backends with their code, settings, commands, tests and docs.
- Goal 4: The model picker offers only the Claude model strengths (Haiku 4.5, Sonnet 5.5, Opus 5.5), all run through the CLI.

## 5. Non-Goals

- Non-goal 1: Installing or logging in the CLI from the browser (the page shows the commands to run in a terminal).
- Non-goal 2: A settable CLI path in the UI (still `CLAUDE_CLI_PATH` or the lookup, ADR 0009).
- Non-goal 3: Changing the tools, approvals or page/history access rules.

## 6. User Stories

- As a new user, I want the browser to tell me what it needs (the Claude Code CLI) and check that it works, so the assistant works the first time I ask.
- As a new user without the CLI, I want the exact install and login steps for my system.
- As a user, I want to pick how strong (and how fast) the model is without knowing model ids.
- As a new user, I want a short explanation of what I can type into the prompt and how skills/macros work.

## 7. Functional Requirements

1. **Welcome page** (new feature `welcome`): a chrome UI page over the page area (the page view is hidden meanwhile, as for `/config`), with × / Escape / "Start browsing" to close. It opens automatically on the first launch of a profile (`userData/welcome.json` has no `done: true`) and with `/welcome` or File → Welcome. Finishing or closing it stores `done: true`.
2. Step 1 "Claude Code CLI": asks "Do you have the Claude Code CLI installed?" Yes → step 2. No → install steps for the platform (macOS/Linux `curl -fsSL https://claude.ai/install.sh | bash`, Windows PowerShell `irm https://claude.ai/install.ps1 | iex`, or `npm install -g @anthropic-ai/claude-code`), then `claude` in a terminal to log in, then a "I've installed it – test it" button.
3. Step 2 "Test": the page calls `agent.checkCli()`. Main checks in order: the CLI starts (`auth status --json`), it is logged in, and it answers a one-line request with the selected model (no tools, no session, 60 s timeout). The page shows each check as ok / failed with the CLI's error message and how to fix it (not found → install / `CLAUDE_CLI_PATH`; not logged in → run `claude` and log in), and, when it answered, the time it took. "Test again" re-runs it. The user may continue to the next step even when a check failed.
4. Step 3 "Model strength": the three models as choices with a one-line description (Haiku 4.5 – fastest, light tasks; Sonnet 5.5 – balanced, the default; Opus 5.5 – strongest, slower). Choosing one updates the agent setting (same as the prompt's picker and `/model`).
5. Step 4 "Using the prompt": how to focus the prompt (Ctrl/Cmd+L, Ctrl/Cmd+I over the page, Ctrl/Cmd+B to hide the panel), that a URL loads the page and anything else goes to the assistant, `@stack` references, `/page-access on` and `/history-access`, and that actions on the page wait for approval.
6. Step 5 "Skills and macros": `/` lists commands and skills; built-in skills (`/reload`, `/stop`); ask "… and store it as /name" to make a macro with `{{parameters}}`; `/skills`, `/config`, `/forget`. A "Start browsing" button closes the page and focuses the prompt.
7. **CLI only**: model ids are the Claude ids (`claude-haiku-4-5`, `claude-sonnet-5-5`, `claude-opus-5-5`), all run through the CLI. Stored `cli:<id>` settings load as `<id>`; Ollama ids load as the default (Sonnet 5.5); a stored `encryptedKey` is dropped on the next save.
8. Removed: `main/anthropic.ts` (its content-block types move to the CLI code), `main/ollama.ts`, the API/Ollama run loop in `Agent`, `/key` and the key field in the prompt, `agent:set-key` and `agent:models` IPC, `hasKey` / `keyPersisted` / `provider` in settings, `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `OLLAMA_HOST` handling (the CLI still gets them stripped from its environment).
9. The prompt's model picker is a plain list of the three models; `/model` accepts an id or a label (`/model opus 5.5`) or the short name (`haiku`, `sonnet`, `opus`).
10. `complete` (history's summaries, Meaning search, Recall) uses the CLI with the selected model.

## 8. Non-Functional Requirements

- Performance: the CLI test runs only when the user asks (opening the page or "Test again"), never at startup otherwise.
- Reliability: the check never throws to the UI; every failure comes back as a failed step with a message; a hung CLI is killed after the timeout.
- Security: one new IPC channel `agent:check-cli` (no arguments; returns step results and messages only, no paths or credentials) and `welcome:*` channels (state, done flag, open request; no arguments except the boolean). Removing the API key removes a stored secret and the `api.anthropic.com` network surface.
- Privacy: the test request is a fixed text ("Reply with OK."), no browsing data. `welcome.json` holds only the done flag.
- Accessibility: steps are headings; choices are real buttons / radio inputs; results use `role="status"`.
- Platforms: install commands per platform (`navigator.platform` in the UI is enough).

## 9. UX / UI Notes

- User flow: first launch → welcome page with a step indicator (1 CLI · 2 Test · 3 Model · 4 Prompt · 5 Skills), Back / Next, × closes.
- Visual considerations: same look as the configuration page (plain CSS, custom properties, light/dark).
- Edge cases: closing the window mid-test; the CLI hangs (timeout); the CLI logged in but the model unavailable on the plan (shows the CLI's message).

## 10. Technical Notes

- Proposed approach: new slice `src/features/welcome/` (`ipc.ts`, `main.ts` with a JSON store and File menu item, `preload.ts`, `ui/WelcomeView.tsx`) registered in the four places; the welcome UI calls `window.antimony.agent.checkCli()` / `updateSettings()`. Agent gains `checkCli` in `main/claude-cli.ts` built from `cliStatus` and `cliComplete`. `Agent` keeps only the CLI path (`runCliTurn`), so `messages`, `useContext`, `closeDanglingToolUses` and `callModel` go.
- Process split: main – welcome store, File menu item, `welcome:open` event; agent check. UI – the page. IPC: `welcome:state|set-done|request-open` (UI → main), `welcome:open` (main → UI); `agent:check-cli` (UI → main).
- Dependencies: welcome UI → agent (`ipc.ts` types, `window.antimony.agent`), prompt (`/welcome` command in `promptCommands`). No new npm packages.
- Risks / unknowns: e2e tests drove the API loop with a scripted fake Anthropic server; they move to the fake CLI, which gets a scripted mode (it asks the test's script server for each step and calls the MCP tools). Fresh e2e profiles are seeded with `welcome.json` so the page doesn't cover other tests.
- Open questions: –

## 11. Acceptance Criteria

- [x] First launch of a fresh profile shows the welcome page; after closing or finishing it, later launches don't; `/welcome` and File → Welcome open it again.
- [x] "No" on step 1 shows the install and login commands; "Yes" goes to the test.
- [x] The test reports found / logged in / answered with timing for a working CLI, "not found" for a missing CLI, and "not logged in" for a logged-out one, each with a fix hint.
- [x] Step 3 changes the selected model; the prompt's picker shows the same choice.
- [x] Steps 4 and 5 explain the prompt and skills; "Start browsing" closes the page.
- [x] The model picker lists exactly Haiku 4.5, Sonnet 5.5 and Opus 5.5; requests run through the CLI.
- [x] `/key`, Ollama and API-key code, settings fields, IPC channels and tests are gone; `cli:` settings migrate.
- [x] `npm run check` and `npm run test:e2e` pass; docs (agent, prompt, skills, welcome READMEs, features index) and a new ADR superseding 0005 and the API-key part of 0004/0009 are updated.

## 12. Testing / Verification

- Manual test plan: fresh profile, walk the steps with the real CLI, with `CLAUDE_CLI_PATH` pointing nowhere, and with a logged-out CLI.
- Automated test coverage: unit – `checkCli` (fake spawn), settings migration, `WelcomeView` steps (jsdom), welcome store; e2e – welcome page on a fresh profile with the fake CLI; prompt e2e moved to the fake CLI.
- Regression considerations: history's `complete` callers; macros and replays; approvals over MCP.

## 13. Rollout / Follow-up

- Rollout plan: ships with the next build; existing users with an API key or Ollama model fall back to Sonnet 5.5 through the CLI.
- Follow-up work: settable CLI path; streaming partial text.

## 14. Changes during implementation

- The CLI is looked up for every use instead of once at startup, so a CLI installed from the welcome page is found without restarting the browser.
- `agent:models` is removed rather than kept for the picker: the picker is a static list of the three models, and the CLI's state shows on the welcome page and in run errors.
- The prompt still records `/key …` as just `/key`, so an API key pasted out of habit never reaches prompt history (the command itself is gone).
- Agent unit tests drive a scripted fake CLI turn (replies per model step, tools called back through `callTool`) instead of the removed API loop; tests about the API key, Ollama, provider switching and history repair after Stop were removed with that code. The e2e fake CLI (`e2e/fixtures/fake-claude.mjs`) got the matching scripted mode (`FAKE_CLAUDE_MODEL_URL`); e2e specs without a model point `CLAUDE_CLI_PATH` at a missing file.
- skills: only its reserved-name test changed (`/key` is no longer a command; `/welcome` is), so its README is unchanged.
- The welcome page's model choice shows at once and the stored setting follows (the controlled radio otherwise snapped back until the IPC answer).
- `docs/features.md` was regenerated from the READMEs; the prompt, skills and stacks rows had drifted from their READMEs and now match them.
