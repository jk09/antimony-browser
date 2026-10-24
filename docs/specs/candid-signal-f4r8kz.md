# Feature Specification: Send feedback and crash reports as GitHub issues

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `/feedback` and a feedback icon in the prompt, and a popup offering to send a crash report; both create an issue in the app's GitHub repository |
| **Spec ID** | candid-signal-f4r8kz |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-24 10:00 +00:00 |
| **Last updated** | 2026-10-24 11:45 +00:00 |
| **Affected features** | feedback (new), prompt |
| **Target release** | 0.1.0 |
| **Related links** | https://github.com/jk09/antimony-browser/issues; ADR 0019; PR https://github.com/jk09/antimony-browser/pull/85 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Users have no way to tell the developers what works or not from inside the app, and crashes go unnoticed unless the user files an issue by hand.
- **Desired outcome:** A feedback icon in the prompt and a `/feedback <text>` command create an issue in `jk09/antimony-browser`; after a crash a small popup asks whether to send a crash report, which on agreement creates an issue too.

## 3. Background and Context

- **Current behavior:** Nothing reports feedback or crashes. Electron shows its own error dialog for uncaught main-process errors; a crashed page or chrome UI renderer just goes blank.
- **Motivation:** Feedback and crash data from real use, filed where the work is tracked (GitHub issues).
- **Related issues or references:** ADR 0009/0015 (the app uses the user's own CLI login instead of storing credentials) – the same idea applies to GitHub through the `gh` CLI.

## 4. Goals

- Goal 1: Send feedback from the prompt in one step (icon → type → Enter).
- Goal 2: Offer a crash report after any crash of the main process, the chrome UI or a page, and send it only if the user agrees.
- Goal 3: Create the issue without Antimony storing any GitHub credentials.

## 5. Non-Goals

- Native minidumps (Electron `crashReporter`) or a crash-collection server.
- Attaching screenshots, page URLs, history or conversation content.
- Recovering the crashed page or chrome UI (reload stays manual).
- Labels, issue templates or deduplicating similar crashes.

## 6. User Stories

- As a user, I want to click a feedback icon, type what I think and press Enter, so that the developers get it as an issue.
- As a user whose browser just crashed, I want to be asked whether to send a report and see what it contains, so that I can help fix it without leaking my browsing.

## 7. Functional Requirements

1. The prompt row has a feedback icon (speech bubble, label "Send feedback") next to `+` and `/`; clicking it puts `/feedback ` in the prompt and focuses it.
2. `/feedback <text>` (a prompt command, listed in suggestions and on the `/config` page) sends the text; `/feedback` with no text says what to type and sends nothing. Text is 1–5000 characters.
3. A feedback issue is titled `Feedback: <first line, up to 60 chars>` and its body holds the text and an *Environment* section: app version, build commit, Electron, Chromium, OS and architecture. Nothing else is sent.
4. Issues are created in `jk09/antimony-browser`:
   - with the user's `gh` CLI (`gh issue create --repo … --title … --body-file -`, found on PATH or the usual install folders, `GH_PATH` overrides), when it runs, is logged in and succeeds within 30 s – the prompt then shows the new issue's URL;
   - otherwise (no `gh`, not logged in, error, timeout) GitHub's new-issue form for the repository opens prefilled (title and body, the body shortened to keep the URL under 8000 characters) in the system's default browser for the user to submit – the prompt says so.
5. Crashes recorded:
   - an uncaught exception or unhandled rejection in the main process (logged as before);
   - `render-process-gone` of the chrome UI or of a page, except the reasons `clean-exit` and `killed`.
6. Each crash is written to `userData/crash-reports.json` (pending reports, at most 5, oldest dropped) right away, then a popup (native message box over the window) asks: "Antimony crashed. Send a crash report to the developers?" with the report's content as detail and the buttons **Send report** and **Don't send**. One popup at a time; crashes during it join the pending list and are sent (or dropped) with it.
7. Pending reports the app couldn't offer (it died first) are offered by the same popup at the next start, once the window is shown.
8. Either answer clears the pending reports. **Send report** creates one issue titled `Crash: <process> <reason or error name>` with every pending report (kind, process – main, chrome UI or page –, reason, exit code, error name, message and stack) and the Environment section; then a second message box says where it went (URL, or the opened form).
9. Stacks and messages have the user's home folder replaced by `~`; no page URL or title is included.

## 8. Non-Functional Requirements

- Performance: nothing runs until feedback is sent or a crash happens; `gh` is spawned only on send.
- Reliability: recording a crash is synchronous and never throws; a corrupt `crash-reports.json` is treated as empty.
- Security: one new IPC channel `feedback:send` (UI → main, a string, validated); `gh` gets fixed arguments, the title and body go as separate argv / stdin, never through a shell. Web content gets nothing new.
- Privacy: only what the user typed, or the crash data shown in the popup, plus the environment. Issues in a public repository are public – the popup and the `/feedback` description say so.
- Accessibility: the icon is a button with an accessible name; the popup is a native dialog.
- Platforms: `gh` lookup handles `gh.exe` on Windows and Homebrew folders on macOS.

## 9. UX / UI Notes

- User flow: icon → `/feedback ` → type → Enter → "Sent as <url>." or "Opened GitHub's new issue form in your browser – submit it there."
- Visual considerations: the icon matches `+` and `/` (`.prompt-icon`).
- Edge cases: sending while another send runs is refused by the prompt's normal flow (the command awaits); an empty `/feedback` shows usage.

## 10. Technical Notes

- Proposed approach: new feature folder `src/features/feedback/` – `shared/report.ts` (pure: titles, bodies, form URL, home-folder scrubbing), `main/github.ts` (`gh` lookup and `createIssue`, spawn injectable for tests), `main/crash-store.ts` (pending reports), `main.ts` (`register`: IPC, crash hooks, popup).
- Process split: main – issue creation, crash hooks, popup; preload – `feedbackBridge.send`; UI – the icon in `Prompt.tsx` and the `/feedback` case in `commands.ts` (prompt).
- Dependencies: Electron `dialog`, `shell.openExternal`, `app.on('render-process-gone')`, `node:child_process`. No new npm packages.
- Risks / unknowns: GitHub's form URL length limits (handled by shortening); users without a GitHub account can't submit the form.
- Open questions: –

## 11. Acceptance Criteria

- [x] The prompt shows a "Send feedback" icon that fills in `/feedback ` and focuses the prompt.
- [x] `/feedback <text>` calls `feedback.send` and shows the issue URL or the form message; `/feedback` alone sends nothing.
- [x] With a working `gh`, an issue is created with the expected title, body and repo through argv/stdin; when `gh` fails the prefilled form URL opens instead.
- [x] The form URL stays under 8000 characters.
- [x] A main-process error and a crashed renderer (not `clean-exit`/`killed`) are stored and offered in a popup; Send creates one issue with all pending reports, Don't send drops them; both clear the store.
- [x] Pending reports from an earlier run are offered at start.
- [x] Reports contain no home-folder paths.

## 12. Testing / Verification

- Manual test plan: `/feedback hello` with and without `gh auth`; crash a page with `chrome://crash`-like means (e.g. `process.crash()` from devtools of a page view is not reachable – use the e2e hook or kill the renderer process) and check the popup.
- Automated test coverage: unit – `shared/report.test.ts`, `main/github.test.ts` (fake spawn), `main/crash-store.test.ts`, `main.test.ts` (IPC validation, crash → popup → send/drop); prompt UI tests for the icon and `/feedback`.
- Regression considerations: prompt command list and `/config` page include the new command.

## 13. Rollout / Follow-up

- Rollout plan: ships enabled, no flag.
- Follow-up work: labels once they exist in the repo; native minidumps; offer to reload a crashed page.

## 14. Changes during implementation

- The crash e2e test (`e2e/feedback.spec.ts`) crashes a real page renderer through the DevTools protocol (`Page.crash`) and replaces the popup and the browser opening in the main process, so no issue is created.
- `gh` is also looked up in `/usr/bin` and, on Windows, `Program Files\GitHub CLI`.
