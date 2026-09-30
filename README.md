# Antimony

A minimal Chromium-based web browser, built on [Electron](https://www.electronjs.org/) with TypeScript and React.

## Develop

Requirements: Node.js 22 (`.nvmrc`) and git. Linux end-to-end tests without a display also need `xvfb-run`.

```sh
npm install
npm run dev        # start with hot reload
npm run check      # lint, format check, typecheck, unit tests
npm run test:e2e   # build and run Playwright against the app
npm run build      # production build into out/
```

| Path | What |
|---|---|
| `src/app/main/` | Main process entry: window, security defaults, feature registration |
| `src/app/preload/` | Builds the `window.antimony` bridge from the features' bridges |
| `src/app/renderer/` | Chrome UI shell (React) |
| `src/features/<feature>/` | One folder per feature: `ipc.ts`, `main.ts`, `preload.ts`, `ui/`, tests, `README.md` |
| `src/shared/` | Types used by every process (bridge API, feature flags) |
| `e2e/` | Playwright end-to-end tests |
| `docs/` | [Architecture](docs/architecture.md), [features index](docs/features.md), [ADRs](docs/adr/), [specs](docs/specs/) |

## How work is done here

This repo uses the spec-driven Claude Code workflow from [jk09/claude-skills](https://github.com/jk09/claude-skills), adapted to this stack:

**spec → implement → ship**, with feature docs kept in sync with the code.

- `.claude/skills/spec` – write a spec in `docs/specs/`, get approval, set it `Active`.
- `.claude/skills/ship` – run checks, tick acceptance criteria, update docs, commit, open a PR.
- `.claude/skills/document-feature` – feature README, ADRs and `docs/features.md`.
- `.claude/skills/audit-features` – monthly check for sprawl, overdue flags and unrecorded security surface.
- Hooks (`.claude/settings.json`, Node scripts in `.claude/scripts/`): load the active spec at session start, install dependencies in cloud sessions, and block "done" while feature docs or the active spec lag the code. CI runs the same doc check on pull requests.

Rules for agents and humans: [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE)
