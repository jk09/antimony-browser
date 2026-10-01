# history – agent notes

- Schema changes: bump `SCHEMA_VERSION` in `main/db.ts` and add a migration step; never edit the v1 `schema` in place once shipped.
- Keep large columns (`text`, `screenshot`) last in `pages`; add small columns before them (in a migration, `ALTER TABLE` appends, so prefer a new table for big data).
- Every column indexed by `pages_fts` must be listed in `ftsColumns`; the triggers are generated from it.
- `shared/page-meta.ts › readPageMeta` is serialized with `toString()`: keep it self-contained (no imports, helpers or outer variables).
- Costly data (screenshot, summary) needs `max_dwell_ms ≥ HIGH_DWELL_MS`: flush dwell before writing it, or SQLite's CHECK rejects the write.
- Nothing about a page goes to a model without the user's opt-in (`summaries`) or request (Meaning search); wrap page data in `<untrusted_…>` tags.
