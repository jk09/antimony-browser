---
name: audit-features
description: Audit the codebase for feature sprawl – undocumented or missing features, overlapping responsibilities, overdue feature flags, stale CLAUDE.md lines, unrecorded security surface. Use for the monthly audit or when asked to check docs against code.
---

# Audit features

Read-only: report findings, don't fix them unless the user asks.

1. Compare `docs/features.md` with the folders in `src/features/`. List:
   - **Undocumented** – folder without a row or without a `README.md`.
   - **Missing** – row or README for a folder that no longer exists.
   - **Unregistered / orphaned** – feature folders not registered in `src/app/main/features.ts`, `src/shared/api.ts` or `src/app/preload/index.ts`, and registrations pointing at folders that no longer exist.
   - **Overlapping** – features whose Purpose or Entry points cover the same responsibility; name both and the overlap.
   - **Cross-feature dependencies** added since the last audit (Dependencies sections, imports between feature folders: `grep -rnE "from '\.\./[a-z-]+/" src/features`, `git log --since="1 month ago" -- src/features`).
2. **Overdue flags**: from every feature README's Feature flags table, list flags whose "Remove by" date is today or earlier, with owner. Flags without owner or date count as overdue. Flags in `src/shared/flags.ts` without a README row count too.
3. **Security surface**: IPC channels in each feature's `ipc.ts` that its README doesn't list; `ipcMain` handlers that don't check the sender; permissions granted, preloads attached to web content or `secureWebPreferences` overrides without an ADR.
4. **Stale instructions**: check the root `CLAUDE.md`, `src/features/CLAUDE.md` and each feature `CLAUDE.md` for lines that are outdated (refer to missing files, features or rules), duplicate a README or another CLAUDE.md, or belong in a skill (procedures) rather than an always-loaded rule.
5. **Specs and ADRs**: specs still `Active` with no commit in the last month; ADRs left `Proposed`; ADRs for removed features not marked `Obsolete`; npm packages bundled into the app without an ADR.
6. Report as one table per section (item, location, suggested action). End with the three most valuable clean-ups.
