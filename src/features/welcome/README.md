# welcome

Walks new users through setup on a welcome page over the page area: asks whether the Claude Code CLI is installed (with install and login commands for their system if not), tests that it starts, is logged in and answers, lets them pick the model strength and a theme for their needs (appearance's picker), and explains the prompt and skills. It opens on a profile's first launch and again with `/welcome` or File → Welcome.

## Entry points
- UI: `ui/WelcomeView.tsx` (mounted next to the configuration page in `App.tsx`) – six steps (Claude Code CLI · Test · Model · Theme · Prompt · Skills) with Back / Next; the Theme step shows the `themeStep` slot `App.tsx` fills with appearance's `ThemePicker` (no slot, no step) and can be skipped; the page view is hidden while it shows; ×, Escape or Start browsing closes it
- IPC: `welcome:state|set-done|request-open` (UI → main), `welcome:open` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – the done flag's store, File → Welcome

## Invariants
- Opens by itself only while the profile has no `done` flag; closing or finishing it sets the flag – `ui/WelcomeView.test.tsx › opens on the first launch only…`, `› closes with × or Escape…`, `main.test.ts`, `e2e/prompt.spec.ts › a fresh profile opens the welcome page…`
- The test runs only when the user reaches it or asks again, and shows each check with the CLI's message and a fix – `ui/WelcomeView.test.tsx › tests a working CLI…`, `› says what failed…`, `› shows the install steps…`
- The Theme step appears only with a slot, after Model, and Next skips it – `ui/WelcomeView.test.tsx › has a Theme step…`, `e2e/prompt.spec.ts › a fresh profile…`
- The model step changes the same setting as the prompt's picker – `ui/WelcomeView.test.tsx › picks the model strength`, `e2e/prompt.spec.ts › a fresh profile…`

## Dependencies
- Features: appearance (its picker, passed in by `App.tsx`; welcome imports none of its code), agent (`checkCli`, `settings`, `updateSettings` via `window.antimony.agent`; `claudeModels`, `CliCheck` from `ipc.ts`); prompt runs `/welcome`
- App: `createJsonStore` (`src/app/main/json-store.ts`), `ctx.fileMenu` (ADR 0003)
- Stored data: `userData/welcome.json` (`{ done }`)

## Security surface
- IPC: the chrome UI can read and set the done flag (a boolean) and ask main to open the page; the CLI test goes through the agent's `agent:check-cli`, which sends a fixed one-line request and no browsing data.
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: first-light-w5k8rd, fitting-palette-t7q3mw · ADRs: 0015, 0016
