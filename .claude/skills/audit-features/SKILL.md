---
name: audit-features
description: Audit the codebase for feature sprawl – undocumented or missing features, overlapping responsibilities, overdue feature flags, stale CLAUDE.md lines. Use for the monthly audit or when asked to check docs against code.
---

# Audit features

Read-only: report findings, don't fix them unless the user asks.

1. Compare `docs/features.md` with the folders in `src/Api/Features/`. List:
   - **Undocumented** – folder without a row or without a `README.md`.
   - **Missing** – row or README for a folder that no longer exists.
   - **Overlapping** – features whose Purpose or Entry points cover the same responsibility; name both and the overlap.
   - **Cross-feature dependencies** added since the last audit (Dependencies sections, `git log --since="1 month ago" -- src/Api/Features`).
2. **Overdue flags**: from every feature README's Feature flags table, list flags whose "Remove by" date is today or earlier, with owner. Flags without owner or date count as overdue.
3. **Stale instructions**: check the root `CLAUDE.md` and each feature `CLAUDE.md` for lines that are outdated (refer to missing files, features or rules), duplicate a README or another CLAUDE.md, or belong in a skill (procedures) rather than an always-loaded rule.
4. **Specs and ADRs**: specs still `Active` with no commit in the last month; ADRs left `Proposed`; ADRs for removed features not marked `Obsolete`.
5. Report as one table per section (item, location, suggested action). End with the three most valuable clean-ups.
