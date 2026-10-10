# Antimony

A minimal Chromium-based web browser, built on [Electron](https://www.electronjs.org/) with TypeScript and React.

## What it is

Antimony is a desktop web browser organised around an AI assistant instead of a toolbar. Where mainstream browsers add AI as a side feature on top of tabs, menus and settings pages, Antimony has a single prompt: type a URL to open a page, `/command` to run a command, or plain language to ask the assistant to do something.

**Who it is for:** people who spend their day in the browser and want to hand repetitive or multi-step web work to an assistant, without giving up control of what it does.

**What it offers**

- **One prompt for everything.** The location bar and the assistant are the same input, docked in a side panel so the page keeps its full size. Every application menu item is reachable from it too (`/menu`), so there is no menu bar to hunt through.
- **An assistant that acts in the browser.** It can navigate, open tabs, read the page, click and type. Every page action needs your approval first.
- **Claude through your own Claude Code login.** The assistant runs on the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed on your computer; pick Haiku, Sonnet or Opus for speed or strength. A welcome page on first launch checks the CLI is installed and answering, and shows how to use the prompt and skills.
- **Memory you can search.** Every page you visit is stored once in a local database. Find it again by address, by the words it contained or by what it was about, and turn any page into a bookmark by adding a note.
- **Macros.** Ask the assistant to store a sequence of browser actions as a `/name` command, then replay it instantly, without calling the model.
- **Tabs as a tree.** Each tab's navigation is shown as a branching tree of breadcrumbs, so you can go back to any earlier page and follow a different link without losing the path you were on.

**Privacy and security:** browsing history and settings stay on your device. Web pages run in sandboxed views with no access to the browser's internals, and the assistant sends page content to Claude (through your Claude Code CLI) only when you turn page access on. Antimony stores no API key.

**Status:** early-stage and under active development; see [docs/features.md](docs/features.md) for what exists today.

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
