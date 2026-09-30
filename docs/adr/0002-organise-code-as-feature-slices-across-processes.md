# 0002. Organise code as feature slices across processes

- Status: Proposed
- Date: 2026-09-30
- Features: – (whole app)
- Spec: –

## Context
An Electron feature spans three processes: main (Electron and Node APIs), preload (the bridge) and renderer (the chrome UI). The workflow in `CLAUDE.md` wants one folder per feature, so a feature can be documented, audited and removed as a unit.

## Options considered
1. **Split by process** (`src/main`, `src/preload`, `src/renderer`, electron-vite's default) – familiar. Cons: every feature is spread over three trees; removing one means hunting through all of them; no natural home for a feature README.
2. **Feature slices** (`src/features/<feature>/{ipc.ts, main.ts, preload.ts, ui/}`) plus thin composition roots in `src/app/<process>/` – one folder per feature. Cons: process boundaries aren't visible from the folder tree, so they must be enforced by tooling.

## Decision
Option 2. Process boundaries are enforced by ESLint (`no-restricted-imports` in `eslint.config.mjs`) and by two TypeScript projects (`tsconfig.node.json`, `tsconfig.web.json`). Each feature is wired in with one line in each composition root.

## Consequences
- Feature docs, the Stop hook and the audit skill work per folder.
- Four registration points per feature; the audit skill checks they match the folders.
- Features that need each other import only the other's `ipc.ts` types or `main.ts` exports, which keeps cross-feature dependencies visible.
