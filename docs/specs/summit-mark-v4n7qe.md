# Feature Specification: Antimony app icon for light and dark themes

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Mountain app icon, a light and a dark version that follow the system theme |
| **Spec ID** | summit-mark-v4n7qe |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-24 10:10 +00:00 |
| **Last updated** | 2026-10-24 10:40 +00:00 |
| **Affected features** | – (app shell: `src/app/main/`, new `resources/icons/`) |
| **Target release** | 0.1.0 |
| **Related links** | Design: the three-tile mountain image attached in the session (left tile = light, centre tile = dark); PR https://github.com/jk09/antimony-browser/pull/89 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Antimony shows Electron's default icon in the taskbar, dock and window switcher, so it can't be told apart from other Electron apps.
- **Desired outcome:** Antimony has its own mountain icon: a white tile with a black outline and black mountains in the light theme, a black tile with white mountains in the dark theme.

## 3. Background and Context

- **Current behavior:** No icon is set; there are no icon assets and no packaging configuration.
- **Motivation:** Recognisable app identity; the icon should fit the system's light or dark look.
- **Related issues or references:** –

## 4. Goals

- Goal 1: Antimony's window (Windows, Linux) and dock (macOS) use the mountain icon.
- Goal 2: The light version shows while the system theme is light, the dark version while it is dark, switching live when the system theme changes.

## 5. Non-Goals

- Non-goal 1: Installer / packaged-app icons (`.ico`, `.icns`); there is no packaging setup yet.
- Non-goal 2: Following the theme chosen in Antimony's own Appearance picker (it restyles the chrome UI, not the OS chrome the icon sits in).
- Non-goal 3: Showing the icon inside the chrome UI (welcome page, favicon).

## 6. User Stories

- As a user, I want Antimony to have its own icon so that I can find its window in the taskbar or dock.
- As a user of a dark system theme, I want the icon's dark version so that it fits my desktop.

## 7. Functional Requirements

1. The icon artwork is a vector trace of the attached design: two SVG sources (`resources/icons/antimony-light.svg`, `antimony-dark.svg`) and 512 × 512 PNGs rendered from them (Electron's `nativeImage` can't load SVG).
2. At startup the main process picks the PNG for `nativeTheme.shouldUseDarkColors` and sets it on the window (`BrowserWindow.setIcon`, Windows/Linux) and the dock (`app.dock.setIcon`, macOS).
3. On `nativeTheme` `updated` the icon is swapped when the light/dark state changed.
4. A missing or unreadable icon file never stops startup; Electron's default stays.

## 8. Non-Functional Requirements

- Performance: two small PNGs read once each; no measurable startup cost.
- Reliability: see requirement 4.
- Security: no IPC, no web-content access, no new permissions; files are read from the app's own folder.
- Privacy: –
- Accessibility: both versions are pure black/white with full contrast.
- Platforms: Windows and Linux set the window icon; macOS sets the dock icon (macOS windows have no icon). Linux desktop environments may still prefer a `.desktop` file's icon when one exists.

## 9. UX / UI Notes

- User flow: none; the icon is just there.
- Visual considerations: tiles keep the design's rounded square; the light version keeps its dark outline so it reads on light taskbars.
- Edge cases: high-contrast mode counts as whatever `shouldUseDarkColors` reports.

## 10. Technical Notes

- Proposed approach: `src/app/main/app-icon.ts` with a pure `iconFile(dark)` and `applyAppIcon(window)` that wires `nativeTheme`; called from `createWindow` in `src/app/main/index.ts`. A dev script `scripts/render-icons.mjs` re-renders the PNGs from the SVGs with the installed Playwright Chromium.
- Process split: main only. No IPC channels.
- Dependencies: Electron `nativeTheme`, `nativeImage`, `app.dock`. No npm packages.
- Risks / unknowns: the source image is a small, compressed raster, so the trace is drawn by hand and may differ in small details.
- Open questions: –

## 11. Acceptance Criteria

- [x] `resources/icons/` holds light and dark SVG sources and 512 × 512 PNGs that match the attached design.
- [x] With a light system theme the window/dock icon is the light version; with a dark one, the dark version (unit test of the selection and of the `updated` handler).
- [x] Changing the system theme while Antimony runs swaps the icon (unit test).
- [x] A missing icon file doesn't stop startup (unit test).
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: run `npm run dev`, switch the OS between light and dark and watch the taskbar/dock icon.
- Automated test coverage: unit tests for `app-icon.ts` with `electron` mocked.
- Regression considerations: existing e2e tests still start the app.

## 13. Rollout / Follow-up

- Rollout plan: ships with the next build; no flag.
- Follow-up work: `.ico` / `.icns` and a Linux `.desktop` icon once packaging exists.

## 14. Changes during implementation

- The centre (dark) tile in the design differs slightly from the left one (cut of the main face, notch on the right peak), so each version is traced from its own tile rather than one being the inverse of the other.
- The light tile's outline is a little thicker than in the design (10 of 512 px) so it stays visible at taskbar sizes.
- Verified in Electron that both PNGs load from `app.getAppPath()`; the OS-theme switch itself is covered by unit tests only (no desktop in the cloud session).
