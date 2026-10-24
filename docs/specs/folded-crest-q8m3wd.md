# Feature Specification: Windows .ico and macOS .icns app icons for packaging

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Packaging icons: `antimony.ico` (Windows) and `antimony.icns` (macOS) built from the dark mountain tile |
| **Spec ID** | folded-crest-q8m3wd |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-24 11:07 +00:00 |
| **Last updated** | 2026-10-24 11:20 +00:00 |
| **Affected features** | – (app shell: `resources/icons/`, `scripts/render-icons.mjs`) |
| **Target release** | 0.1.0 |
| **Related links** | spec summit-mark-v4n7qe (runtime icon, follow-up item); PR https://github.com/jk09/antimony-browser/pull/89 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** A packaged Antimony (installer, `.exe`, `.app` bundle) needs its icon in the platform formats; only runtime PNGs exist.
- **Desired outcome:** `resources/icons/antimony.ico` and `resources/icons/antimony.icns`, generated from the SVG sources by the existing render script, ready for a packager to point at.

## 3. Background and Context

- **Current behavior:** `resources/icons/` has light and dark SVGs and 512 px PNGs; the main process switches between them with the system theme. There is no packaging setup.
- **Motivation:** Follow-up listed in spec summit-mark-v4n7qe.
- **Related issues or references:** –

## 4. Goals

- A multi-size `.ico` for Windows and an `.icns` for macOS, both from the dark tile.
- One command (`node scripts/render-icons.mjs`) regenerates every icon file from the SVGs, with no new dependencies.

## 5. Non-Goals

- Adding a packager (electron-builder, Forge) or its configuration.
- A theme-switching packaged icon (`.ico` / `.icns` hold one design; the running app still switches).
- Linux `.desktop` file / icon theme installation.

## 6. User Stories

- As a maintainer, I want ready-made `.ico` and `.icns` files so that packaging needs only a path.
- As a user, I want the installed app's icon to match the running app's.

## 7. Functional Requirements

1. Both files use the dark tile (`antimony-dark.svg`): it reads on light and dark taskbars, docks and file browsers.
2. `antimony.ico` holds PNG-encoded images at 16, 24, 32, 48, 64, 128 and 256 px, rendered from the SVG at each size (not downscaled from one bitmap), with the tile as in the runtime PNGs.
3. `antimony.icns` holds PNG-encoded images for 16, 32, 64, 128, 256, 512 and 1024 px (types `icp4`, `icp5`, `ic11`, `ic12`, `ic07`, `ic13`, `ic08`, `ic14`, `ic09`, `ic10`), with the tile shrunk to Apple's icon grid (824 × 824 of 1024, centred, transparent around it).
4. `scripts/render-icons.mjs` writes both files next to the PNGs, encoding the containers itself (no npm package, no platform tool).

## 8. Non-Functional Requirements

- Performance: build-time only; nothing changes at runtime.
- Reliability: the files open in standard readers (Pillow, `file`).
- Security: no runtime change, no new dependency.
- Privacy: –
- Accessibility: full black/white contrast.
- Platforms: `.ico` for Windows, `.icns` for macOS; Linux keeps using the PNGs.

## 9. UX / UI Notes

- User flow: none until a packager uses the files.
- Visual considerations: macOS version follows Apple's grid so it matches other dock icons; Windows fills the square like the runtime icon.
- Edge cases: 16 px renders straight from the vector, so the mountains stay readable.

## 10. Technical Notes

- Proposed approach: extend `scripts/render-icons.mjs`: render the dark SVG with Playwright Chromium at each size (CSS-scaled inside a transparent square for the macOS grid), then pack ICO (6-byte header, 16-byte directory entries, PNG payloads) and ICNS (`icns` + big-endian length, then `type` + length + PNG per entry).
- Process split: none (build script).
- Dependencies: `@playwright/test` (dev, already installed).
- Risks / unknowns: Windows Explorer accepts PNG entries in ICO since Vista; older Windows is unsupported by Electron anyway.
- Open questions: –

## 11. Acceptance Criteria

- [x] `resources/icons/antimony.ico` exists, holds the seven sizes, each a PNG of the dark tile.
- [x] `resources/icons/antimony.icns` exists, its length header matches the file size, and it holds the ten entry types with PNGs of the listed sizes, the tile at 824/1024.
- [x] Both files open in Pillow at their largest size and look like the dark tile.
- [x] `node scripts/render-icons.mjs` regenerates all icon files; running it twice changes nothing visible.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: open the `.ico` and `.icns` in an image viewer / Finder Quick Look.
- Automated test coverage: none in Vitest (build artefacts); verified with Pillow and `file` when generated.
- Regression considerations: runtime PNGs are regenerated by the same script and must stay identical in look.

## 13. Rollout / Follow-up

- Rollout plan: files only; a packager PR wires them up.
- Follow-up work: packaging setup; a Liquid Glass `.icon` (light/dark) for macOS 26 if wanted.

## 14. Changes during implementation

- Verified with Pillow and `file`: 7 ICO sizes and 10 ICNS entries, all PNG; the ICNS length header matches; the 1024 px tile spans 100–924 px; two runs give byte-identical files and leave the runtime PNGs unchanged.
