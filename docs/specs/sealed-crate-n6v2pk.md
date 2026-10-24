# Feature Specification: Package Antimony with electron-builder

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | electron-builder config and `npm run dist`, plus a CI workflow that builds Windows, macOS and Linux packages on version tags |
| **Spec ID** | sealed-crate-n6v2pk |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-24 11:19 +00:00 |
| **Last updated** | 2026-10-24 11:40 +00:00 |
| **Affected features** | – (build and app shell: `package.json`, `electron-builder.yml`, `.github/workflows/`) |
| **Target release** | 0.1.0 |
| **Related links** | specs summit-mark-v4n7qe, folded-crest-q8m3wd (icons); ADR 0020; PR https://github.com/jk09/antimony-browser/pull/94 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Antimony runs only from a source checkout (`npm run dev` / `npm start`); there is no way to install it.
- **Desired outcome:** `npm run dist` builds installable packages for the current platform, and pushing a `v*` tag builds them for Windows, macOS and Linux in CI.

## 3. Background and Context

- **Current behavior:** No packager; icons for packaging (`antimony.ico`, `antimony.icns`) exist in `resources/icons/` but nothing uses them.
- **Motivation:** Let people install Antimony; follow-up of spec folded-crest-q8m3wd.
- **Related issues or references:** –

## 4. Goals

- electron-builder config producing: Windows NSIS installer; macOS `.dmg` and `.zip` for x64 and arm64; Linux AppImage and `.deb`.
- `npm run dist` (packages for this platform) and `npm run dist:dir` (unpacked app, fast check).
- A GitHub Actions workflow that builds on `v*` tags and on manual dispatch, on Windows, macOS and Linux runners, and uploads the packages as workflow artifacts.

## 5. Non-Goals

- Code signing and notarization (builds are unsigned; Gatekeeper and SmartScreen will warn).
- Auto-update and publishing to GitHub Releases.
- Store builds (Microsoft Store, Mac App Store, Snap, Flatpak).

## 6. User Stories

- As a user, I want an installer for my OS so that I can run Antimony without Node.js and a checkout.
- As the maintainer, I want a tag to produce all packages so that releasing needs no local cross-platform setup.

## 7. Functional Requirements

1. `electron-builder.yml` at the repo root: app ID `io.github.jk09.antimony`, product name `Antimony`, output `dist/`.
2. The package contains only `out/**` (the electron-vite build), `resources/icons/*.png` and `package.json`, in an asar archive; no `node_modules` (the app has no runtime dependencies; React is bundled).
3. Icons: `antimony.ico` (Windows), `antimony.icns` (macOS), `antimony-dark.png` (Linux).
4. Targets: Windows `nsis` (x64; per-user, choice of folder); macOS `dmg` and `zip` (x64, arm64); Linux `AppImage` and `deb` (x64).
5. `npm run dist` = `electron-vite build` then `electron-builder --publish never`; `npm run dist:dir` the same with `--dir`.
6. The packaged app starts, loads the chrome UI from the asar (not the dev server) and shows the theme icon (`app.getAppPath()` points into the asar).
7. `.github/workflows/package.yml`: on `push` of tags `v*` and `workflow_dispatch`; matrix of `ubuntu-latest`, `windows-latest`, `macos-latest`; `npm ci`, `npm run dist`; uploads `dist/*.{exe,dmg,zip,AppImage,deb}` as one artifact per OS; `permissions: contents: read`; signing auto-discovery off.

## 8. Non-Functional Requirements

- Performance: no runtime change.
- Reliability: the packaged app behaves as `npm start`.
- Security: `secureWebPreferences`, fuses and the browsing session are unchanged; the package adds no runtime code. electron-builder is a dev dependency only. The CI workflow has read-only permissions and no secrets.
- Privacy: –
- Accessibility: –
- Platforms: unsigned macOS builds need right-click → Open (or `xattr -d com.apple.quarantine`); Windows shows SmartScreen.

## 9. UX / UI Notes

- User flow: download the package from the workflow run, install, launch.
- Visual considerations: installers and the `.app` use the dark tile icons.
- Edge cases: Linux AppImage needs FUSE (documented by AppImage).

## 10. Technical Notes

- Proposed approach: add `electron-builder` as a dev dependency, the YAML config, two npm scripts, the workflow, `author` in `package.json` (needed by `.deb`), docs (README "Install / package", architecture, ADR 0020 on choosing electron-builder over Electron Forge).
- Process split: none.
- Dependencies: `electron-builder` (dev).
- Risks / unknowns: electron-builder downloads Electron and packaging tools at build time; `nativeImage.createFromPath` must read the icon from inside the asar (to verify).
- Open questions: –

## 11. Acceptance Criteria

- [x] `npm run dist:dir` on Linux produces an unpacked app that starts, loads the chrome UI and finds its icons in the asar.
- [x] `npm run dist` on Linux produces an AppImage and a `.deb` with the app inside.
- [x] The config defines the Windows and macOS targets and icons listed above.
- [x] The workflow builds on `v*` tags and manual dispatch on three OSes and uploads the packages.
- [x] `npm run check` passes; README, architecture doc and ADR 0020 describe packaging.

## 12. Testing / Verification

- Manual test plan: run the Linux packages here; run the workflow by dispatch after merge to check Windows and macOS.
- Automated test coverage: none new (build tooling); existing e2e keep testing the app.
- Regression considerations: `npm run dev` / `npm start` / e2e unchanged.

## 13. Rollout / Follow-up

- Rollout plan: merge, then dispatch the workflow (or push `v0.1.0`).
- Follow-up work: signing and notarization; publishing to GitHub Releases; auto-update.

## 14. Changes during implementation

- The Package workflow also runs on pull requests that change the packaging files (config, `package.json`, lockfile, `resources/`, the workflow), so Windows and macOS builds are checked before merge; Linux was verified locally.
- `desktopName: antimony.desktop` in `package.json` and `linux.syncDesktopName`, so Linux desktops link the window to its `.desktop` entry; the Linux executable is `antimony`.
- Verified locally: `dist:dir` and the AppImage start, load the chrome UI from the asar and read both icon PNGs from it; the `.deb` installs to `/opt/Antimony` with `antimony.desktop` and a 512 px hicolor icon. `npm run check` and the e2e suite pass.
- On PR #94 the Package workflow built the Windows, macOS and Linux packages successfully (each job fails if it finds no package files).
