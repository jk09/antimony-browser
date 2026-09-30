---
name: document-feature
description: Create, update or retire feature documentation (feature README, folder CLAUDE.md, ADRs, docs/features.md index) after code changes. Use when a feature is added, changed, renamed or removed, when the Stop hook reports doc drift, or when the ship skill reaches its docs step.
---

# Document feature

Keep feature docs in sync with the code. Docs describe the **current** behaviour and **why**, never a history of edits (git and the changelog cover history).

## Conventions

- Feature folder: `src/Api/Features/<Feature>/` (one folder = one feature).
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
| **Test/format-only** | Only `*Tests*`, whitespace or formatting changes – skip, say so |

If the user named a specific feature, restrict to it.

## Step 2 – Read before writing

For each feature to document, read: the existing `README.md` and `CLAUDE.md`, the diff for that folder, the endpoint/handler entry points, DI registration (search `Add<Feature>` / `Map<Feature>`), options classes, and the active spec in `docs/specs/` if one exists (**Status** `Active`; its **Affected features** row lists the folders to cover).

Derive facts from code, not from names or guesses. If something can't be determined (e.g. *why* a rule exists), write `TODO(owner): …` rather than inventing a reason.

## Step 3 – Update the feature README

Use `templates/feature-readme.md`. Rules:

- **Purpose**: one or two sentences, business language.
- **Entry points**: routes, message handlers, jobs – with file names.
- **Invariants**: rules that must never break; each should be backed by a test – name the test.
- **Dependencies**: other features, external services, config sections. Flag any new cross-feature dependency to the user (possible sprawl).
- **Feature flags**: name, default, owner, removal date.
- Edit in place; don't append "Update:" paragraphs. Remove lines that are no longer true.
- Stay within ~30 lines. If it won't fit, the feature is probably doing too much – tell the user rather than growing the doc.

## Step 4 – Update the folder CLAUDE.md (only if needed)

Add a line only for a new, non-obvious rule or gotcha an agent would get wrong (e.g. "Refund amounts are in minor units", "Don't call PaymentGateway directly – use IRefundPolicy"). Remove lines the change made obsolete. Don't duplicate the README.

## Step 5 – Decide whether an ADR is needed

Draft an ADR (`templates/adr.md`, next free number, `Status: Proposed`) only if the change:

- introduces a new dependency, package, pattern or infrastructure component,
- chooses between real alternatives with trade-offs,
- changes a cross-cutting convention, or
- reverses an earlier ADR (mark the old one `Superseded by NNNN`; never rewrite its body).

Otherwise don't create one. Never set `Accepted` yourself – ask the user.

## Step 6 – Handle renames and removals

- **Renamed**: move README/CLAUDE.md with the folder, update the index row and any links (`grep -r "<OldName>" docs src`).
- **Removed**: delete the index row; mark ADRs that only concerned this feature `Obsolete (feature removed in <commit/PR>)`; check that DI registrations, options, flags and tests were removed too – list leftovers to the user.

## Step 7 – Regenerate docs/features.md

Rebuild the whole table from the feature folders (don't patch rows), sorted by name:

```markdown
# Features

| Feature | Purpose | Flags | Docs |
|---|---|---|---|
| Invoicing | Generates and emails monthly invoices. | – | [README](../src/Api/Features/Invoicing/README.md) |
| Orders | Create, update and refund customer orders. | `PartialRefunds` | [README](../src/Api/Features/Orders/README.md) |
```

Purpose = the README's first sentence. Features without a README get `⚠ undocumented`.

## Step 8 – Verify and report

- Every changed feature folder has an updated or confirmed-current `README.md`.
- Relative links resolve; no `TODO` without an owner.
- Don't commit – the `ship` skill does that.

Report briefly: files created/updated/deleted, ADRs drafted (need approval), open TODOs, and any sprawl warnings (new cross-feature dependencies, README over budget, expired feature flags).