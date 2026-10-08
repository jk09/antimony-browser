Antimony is a minimal Chromium-based browser: Electron + TypeScript, chrome UI in React. Architecture: [docs/architecture.md](./docs/architecture.md).

## Commands

- `npm run dev` – run with hot reload · `npm run check` – lint, format, typecheck, unit tests · `npm run test:e2e` – build + Playwright end-to-end (Linux without a display: `xvfb-run -a npm run test:e2e`).
- Cloud sessions install dependencies and the Electron binary (SessionStart hook), so `test:e2e` runs there with `xvfb-run -a`; if the binary download is blocked, CI runs the e2e tests. Chromium's sandbox may need `kernel.apparmor_restrict_unprivileged_userns=0` (as in CI); it isn't needed in this container.

## Workflow

- Non-trivial work starts from a spec in the [spec folder](./docs/specs/). No spec → use the [`spec`](.claude/skills/spec/) skill first.
- Finish every task with the [`ship`](.claude/skills/ship/) skill. Don't commit ad hoc.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), scope = feature folder name, `Spec: <spec-id>` line when a spec drove the change. Format in the `ship` skill.

## Features

- One folder per feature under `src/features/<feature>/` with its main, preload, IPC and UI code, a short `README.md` and, if needed, a `CLAUDE.md` for feature-specific rules. Slice layout: [src/features/CLAUDE.md](./src/features/CLAUDE.md). Index: [docs/features.md](./docs/features.md).
- Docs are written by the [`document-feature`](.claude/skills/document-feature/) skill; the Stop hook blocks finishing while feature code or the active spec changed without its docs.
- Removing a feature means deleting its folder, flags, registrations (`src/app/main/features.ts`, `src/app/preload/index.ts`, `src/shared/api.ts`, `src/app/renderer/`), tests and `docs/features.md` row in the same PR.
- Decisions go in `docs/adr/`, append-only: a changed decision gets a new ADR that supersedes the old one. Adding an npm package that ships in the app (not dev tooling) needs an ADR.
- Every feature flag (`src/shared/flags.ts`) has an owner and a removal date in its feature README. The [`audit-features`](.claude/skills/audit-features/) skill lists overdue flags and sprawl.

## Security (always)

- Never weaken `secureWebPreferences` (`src/app/main/security.ts`) or give web content a preload, Node or IPC access; that needs an ADR.
- Web pages live in `WebContentsView`s on the browsing session, never in the chrome UI's webContents. IPC goes through `ctx.ipc` (sender-checked), never `ipcMain` directly; validate every argument.

## Where instructions go

- Short rules that always apply → this file, a few lines. Feature-specific rules → that feature's `CLAUDE.md`.
- Step-by-step procedures → a skill in `.claude/skills/`.
- Steps that must run at a set moment → hooks in `.claude/settings.json` (scripts in `.claude/scripts/`, Node.js `.mjs`, no dependencies).
