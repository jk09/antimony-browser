# 0020. Package with electron-builder, unsigned, built in CI on tags

- Status: Accepted
- Date: 2026-10-24
- Features: – (build)
- Spec: sealed-crate-n6v2pk

## Context
Antimony ran only from a source checkout. Installing it needs a Windows installer, a macOS app bundle and Linux packages, built on each platform (a `.dmg` needs macOS). There are no signing certificates yet, and no release channel or update server.

## Options considered
1. **electron-builder** – one declarative config for every target (NSIS, dmg/zip, AppImage, deb), downloads its own tools, works with electron-vite's `out/` as is; a large dev dependency.
2. **Electron Forge** – Electron's official toolchain, but built around its own bundler plugins; with electron-vite it would duplicate the build or need custom makers.
3. **@electron/packager plus per-format tools** – smallest pieces, but every installer format is wired by hand.

## Decision
Option 1, as a dev dependency (nothing ships in the app). `electron-builder.yml` packs only `out/**`, the runtime icon PNGs and `package.json` into an asar. Targets: Windows NSIS (x64, per-user, folder choice), macOS dmg and zip (x64 and arm64), Linux AppImage and deb (x64). Builds are unsigned and publish nowhere: `.github/workflows/package.yml` builds on `v*` tags, by hand, and on pull requests that change the packaging, on Linux, Windows and macOS runners, and uploads the packages as workflow artifacts. No auto-update.

## Consequences
- `npm run dist` builds this platform's packages; `npm run dist:dir` an unpacked app for a quick check.
- Unsigned: macOS Gatekeeper blocks the first open (right-click → Open), Windows SmartScreen warns. Signing, notarization, GitHub Releases and auto-update each need a new ADR.
- The packaged app keeps the dev build's app name, so it uses the same `userData` folder as `npm start`.
- A runtime npm dependency would now ship in the package; it still needs its own ADR (CLAUDE.md).
