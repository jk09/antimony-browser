---
name: document-feature
description: Create, update or retire feature documentation (feature README, folder CLAUDE.md, ADRs, docs/features.md index) after code changes. Use when a feature is added, changed, renamed or removed, when the Stop hook reports doc drift, or when the ship skill reaches its docs step.
---

# Document feature

Keep feature docs in sync with the code. Docs describe the **current** behaviour and **why**, never a history of edits (git and the changelog cover history).

## Conventions

- Feature folder: `src/features/<feature>/` (one folder = one feature, kebab-case). Slice layout (`ipc.ts`, `main.ts`, `preload.ts`, `ui/`): `src/features/CLAUDE.md`.
- Per feature: `README.md` (for humans + agents, ≤ ~30 lines) and optionally `CLAUDE.md` (agent-only rules/gotchas, ≤ ~15 lines).
- Decisions: `docs/adr/NNNN-<slug>.md`, append-only.
- Index: `docs/features.md`, one row per feature folder. The root `CLAUDE.md` points here; keep feature rules out of the root `CLAUDE.md`.
- Templates: `templates/feature-readme.md` and `templates/adr.md` next to this file.

## Step 1 – Find what changed

```
git diff --name-status main...HEAD
git status --porcelain
```

Group changed paths by feature folder. Classify each feature as:

| Case | Signal |
|---|---|
| **New** | Folder exists, no `README.md` |
| **Changed** | Files modified in an existing folder |
| **Renamed** | `R` entries moving files between feature folders |
| **Removed** | Folder deleted |
| **Test/format-only** | Only `*.test.ts(x)`, `e2e/`, whitespace or formatting changes – skip, say so |

If the user named a specific feature, restrict to it.

## Step 2 – Read before writing

For each feature to document, read: the existing `README.md` and `CLAUDE.md`, the diff for that folder, `ipc.ts` (channels and bridge interface), `main.ts` (`register`: IPC handlers, views, session and webContents hooks), `preload.ts`, the components in `ui/`, its registration lines (`src/app/main/features.ts`, `src/shared/api.ts`, `src/app/preload/index.ts`, `src/app/renderer/App.tsx`), its flags in `src/shared/flags.ts`, anything it stores under `app.getPath('userData')`, and the active spec in `docs/specs/` if one exists (**Status** `Active`; its **Affected features** row lists the folders to cover).

Derive facts from code, not from names or guesses. If something can't be determined (e.g. *why* a rule exists), write `TODO(owner): …` rather than inventing a reason.

## Step 3 – Update the feature README

Use `templates/feature-readme.md`. Rules:

- **Purpose**: one or two sentences, in terms of what the user of the browser gets.
- **Entry points**: UI components and where they mount, IPC channels with direction (UI → main / main → UI), main-process hooks – with file names.
- **Invariants**: rules that must never break; each should be backed by a test – name the test.
- **Dependencies**: other features, Electron APIs, stored data. Flag any new cross-feature dependency to the user (possible sprawl).
- **Security surface**: what the feature exposes to the chrome UI (IPC) or grants web content (permissions, protocols, window opening). `–` if nothing.
- **Feature flags**: name, default, owner, removal date.
- Edit in place; don't append "Update:" paragraphs. Remove lines that are no longer true.
- Stay within ~30 lines. If it won't fit, the feature is probably doing too much – tell the user rather than growing the doc.

## Step 4 – Update the folder CLAUDE.md (only if needed)

Add a line only for a new, non-obvious rule or gotcha an agent would get wrong (e.g. "View bounds are in DIPs, not pixels", "Don't call `webContents.loadURL` directly – use `navigate()` so history sees it"). Remove lines the change made obsolete. Don't duplicate the README.

## Step 5 – Decide whether an ADR is needed

Draft an ADR (`templates/adr.md`, next free number, `Status: Proposed`) only if the change:

- introduces a new npm package shipped in the app, pattern, process, or storage format,
- touches the security model (webPreferences, permissions, preloads for web content, custom protocols),
- chooses between real alternatives with trade-offs,
- changes a cross-cutting convention, or
- reverses an earlier ADR (mark the old one `Superseded by NNNN`; never rewrite its body).

Otherwise don't create one. Never set `Accepted` yourself – ask the user.

## Step 6 – Handle renames and removals

- **Renamed**: move README/CLAUDE.md with the folder, update the index row, registrations, IPC channel prefixes and any links (`grep -rn "<old-name>" docs src e2e`).
- **Removed**: delete the index row; mark ADRs that only concerned this feature `Obsolete (feature removed in <commit/PR>)`; check that registrations, flags, IPC channels, stored data handling and tests were removed too – list leftovers to the user.

## Step 7 – Regenerate docs/features.md

Rebuild the whole table from the feature folders (don't patch rows), sorted by name:

```markdown
# Features

| Feature | Purpose | Flags | Docs |
|---|---|---|---|
| navigation | Loads pages from the address bar and moves back, forward and reload. | – | [README](../src/features/navigation/README.md) |
| tabs | Opens, switches and closes pages in tabs. | `TabGroups` | [README](../src/features/tabs/README.md) |
```

Purpose = the README's first sentence. Features without a README get `⚠ undocumented`.

## Step 8 – Verify and report

- Every changed feature folder has an updated or confirmed-current `README.md`.
- Relative links resolve; no `TODO` without an owner.
- Don't commit – the `ship` skill does that.

Report briefly: files created/updated/deleted, ADRs drafted (need approval), open TODOs, and any sprawl warnings (new cross-feature dependencies, README over budget, expired feature flags, new security surface).
