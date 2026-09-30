## Workflow

- Non-trivial work starts from a spec in the [spec folder](./docs/specs/). No spec → use the [`spec`](.claude/skills/spec/) skill first.
- Finish every task with the [`ship`](.claude/skills/ship/) skill. Don't commit ad hoc.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), scope = feature folder name, `Spec: <spec-id>` line when a spec drove the change. Format in the `ship` skill.

## Features

- One folder per feature under `src/Api/Features/<Feature>/` with its code, a short `README.md` and, if needed, a `CLAUDE.md` for feature-specific rules. Index: [docs/features.md](./docs/features.md).
- Docs are written by the [`document-feature`](.claude/skills/document-feature/) skill; the Stop hook blocks finishing while feature code or the active spec changed without its docs.
- Removing a feature means deleting its folder, flags, DI registrations, tests and `docs/features.md` row in the same PR.
- Decisions go in `docs/adr/`, append-only: a changed decision gets a new ADR that supersedes the old one.
- Every feature flag has an owner and a removal date in its feature README. The [`audit-features`](.claude/skills/audit-features/) skill lists overdue flags and sprawl.

## Where instructions go

- Short rules that always apply → this file, a few lines. Feature-specific rules → that feature's `CLAUDE.md`.
- Step-by-step procedures → a skill in `.claude/skills/`.
- Steps that must run at a set moment → hooks in `.claude/settings.json` (scripts in `.claude/scripts/`, PowerShell 7).
