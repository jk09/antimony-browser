# 0019. File feedback and crash reports as GitHub issues through the user's gh CLI

- Status: Accepted
- Date: 2026-10-24
- Features: feedback, prompt
- Spec: candid-signal-f4r8kz

## Context
Users should be able to send feedback and, after a crash, a crash report, and both should land where the work is tracked: issues in `jk09/antimony-browser`. Creating an issue needs a GitHub identity. Antimony stores no credentials and already relies on the user's own CLI login for the model (ADR 0015). Crash data can contain paths and messages the user may not want public.

## Options considered
1. **A token shipped in the app or a collection server** – no user setup, but a shared secret in the binary (abusable) or a service to run; reports arrive anonymously and can't be followed up.
2. **The user's `gh` CLI, else GitHub's prefilled new-issue form** – no credentials in Antimony, issues under the user's own account; needs `gh` logged in, else one click on GitHub.
3. **Electron `crashReporter` minidumps** – native crash data, but needs a minidump server and symbol upload; doesn't cover feedback.

## Decision
Option 2. `gh issue create` runs with fixed arguments, the body on stdin; on any failure the new-issue form opens prefilled in the default browser (not in a page view, where the user may not be signed in to GitHub, and which may be what crashed). Crashes – uncaught main-process errors and rejections, and renderers gone for any reason but `clean-exit` and `killed` – are stored at once in `crash-reports.json` and sent only after the user agrees in a popup that shows what will be sent; the home folder is replaced with `~` and no URLs or page data are included. The `uncaughtException` handler replaces Electron's default error box with that popup.

## Consequences
- No secrets in the app; spam is bounded by GitHub's per-account limits.
- Users without a GitHub account can't send anything; a non-GitHub channel would need a new ADR.
- Main-process errors no longer show Electron's error box; they are logged and offered as reports, and the app keeps running as before.
- No native minidumps: a crash without a JavaScript error reports only its reason and exit code.
