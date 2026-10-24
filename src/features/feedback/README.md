# feedback

Lets you send feedback to the developers from the prompt (a speech-bubble icon that fills in `/feedback `, then your text and Enter) and, after a crash of the main process, the chrome UI or a page, asks in a popup whether to send a crash report; either becomes an issue in `jk09/antimony-browser`, created with your own `gh` CLI login, or, without one, through GitHub's new-issue form opened prefilled in your default browser.

## Entry points
- IPC: `feedback:send` (UI → main, the text, 1–5000 characters; returns `{ via: 'gh' | 'form', url }`) – `ipc.ts`
- UI: none of its own – prompt's `ui/Prompt.tsx` shows the icon and `ui/commands.ts` runs `/feedback <text>`
- Main: `register` in `main.ts` – the IPC handler; `process.on('uncaughtException' | 'unhandledRejection')` and `app.on('render-process-gone')` record crashes; the popup (`dialog.showMessageBox`: Send report / Don’t send) shows at once, or when the window first shows for reports from an earlier run
- Main: `main/github.ts` (`ghCommand`: `GH_PATH`, PATH, install folders; `ghCreateIssue`: fixed argv, body on stdin, 30 s; `sendIssue`: gh, else the form), `main/crash-store.ts` (pending reports, written synchronously)
- Shared: `shared/report.ts` – issue titles and bodies, the form URL (under 8000 characters), home-folder scrubbing, stored-report parsing

## Invariants
- Issue bodies hold only the user's text or the crash reports plus app, Electron, Chromium and OS versions; the home folder becomes `~` – `shared/report.test.ts`, `main.test.ts › stores a main-process error without the home folder…`
- `gh` runs without a shell, the title as one argument and the body on stdin – `main/github.test.ts › passes the title as an argument…`
- When `gh` fails, the prefilled form opens instead and its URL stays under GitHub's limit – `main/github.test.ts › opens the prefilled form…`, `shared/report.test.ts › shortens a long body…`
- A crash is offered once in one popup (crashes during it join it); either answer clears the pending reports; `clean-exit` and `killed` renderers are ignored – `main.test.ts`, `e2e/feedback.spec.ts`
- Empty, over-long or non-text feedback is rejected; `/feedback` alone sends nothing – `main.test.ts › rejects…`, `../prompt/ui/Prompt.test.tsx › the feedback icon…`

## Dependencies
- Features: prompt (mounts the icon and `/feedback`, through `window.antimony.feedback`)
- Electron: `dialog`, `shell.openExternal`, `app` `render-process-gone`; Node `child_process` (the user's `gh`)
- App: `buildCommit` (`src/shared/build-info.ts`)
- Stored data: `userData/crash-reports.json` (pending reports, at most 5, removed once answered)

## Security surface
- IPC: the chrome UI can send a feedback string, which becomes a public GitHub issue.
- Main: spawns the user's `gh` (or `GH_PATH`) with fixed arguments; opens one `https://github.com/jk09/antimony-browser/issues/new` URL in the default browser. Registering an `uncaughtException` handler replaces Electron's own error box (ADR 0019).
- Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: candid-signal-f4r8kz · ADRs: 0019
