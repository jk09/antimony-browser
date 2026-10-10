# appearance

Lets you describe the theme you need in your own words ("a light theme suitable for astigmatism") and pick one from real screenshots of the browser: the selected model proposes 3–4 themes using built-in usability guidance (WCAG 2.2, astigmatism, light sensitivity, low vision, dyslexia, colour-vision deficiency), Antimony repairs any colour below WCAG 2.2 AA contrast, applies each candidate in turn to capture the window, and applies the one you pick to the browser's own UI. Reached from the welcome page's Theme step, `/settings theme` and File → Appearance….

## Entry points
- UI: `ui/ThemeApplier.tsx` (in `App.tsx`; applies the stored theme as inline custom properties and `color-scheme` on the root element), `ui/ThemePicker.tsx` (description, need chips, generation, capture loop over a sample scene, gallery; the welcome page's Theme step slot in `App.tsx`), `ui/AppearanceView.tsx` (the picker over the page area, the page view hidden; × or Escape closes), `ui/apply.ts`
- IPC: `appearance:get|set|generate|capture|request-open` (UI → main), `appearance:changed|open` (main → UI) – `ipc.ts`; `themeNeeds` (the suggested needs) for the welcome step and `/settings theme`
- Main: `register` in `main.ts` – theme store, File → Appearance…; `main/generate.ts` (system prompt with the usability guidance, request text, answer parsing, one retry)
- Shared: `shared/contrast.ts` (WCAG relative luminance and contrast ratio, hue-keeping lightness repair), `shared/theme.ts` (tokens, parsing, the contrast rules, `checkTheme`, `themeProperties`), `shared/sample-theme.ts` (test fixture)

## Invariants
- Contrast follows WCAG 2.2: text tokens ≥ 4.5:1 on every background, button text ≥ 4.5:1 on the accent, focus ring, field borders and cloud colours ≥ 3:1; failing colours are repaired (lightness only) or the theme dropped – `shared/contrast.test.ts`, `shared/theme.test.ts`
- Model output is data: only `#rrggbb` values for known tokens are accepted, never CSS text; `set` and the stored file are checked again in main – `shared/theme.test.ts › parseTheme`, `main.test.ts › rejects malformed…`, `› ignores a stored theme…`
- Only the description and the token names go to the model – `main/generate.test.ts`, `main.test.ts › generates themes…`
- After capturing, the window is back in the stored theme, also when capturing fails – `ui/ThemePicker.test.tsx`, `e2e/prompt.spec.ts › the welcome page picks a theme…`
- The chosen theme persists across restarts; the system default removes every themed property – `ui/ThemePicker.test.tsx › applyTheme…`, `e2e/prompt.spec.ts › the welcome page picks a theme…`

## Dependencies
- Features: agent (`complete` from `main.ts`, the selected model through the Claude Code CLI); welcome shows the picker in its Theme step slot and prompt's `/settings theme` calls `requestOpen` and `set` (both through `window.antimony.appearance`)
- App: `createJsonStore` (`src/app/main/json-store.ts`), `ctx.fileMenu` (ADR 0003), the colour tokens in `src/app/renderer/styles.css`
- Electron: `webContents.capturePage` of the chrome UI, `nativeImage.resize` / `toJPEG`
- Stored data: `userData/appearance.json` (`{ theme }`: name, rationale, scheme, colours)

## Security surface
- IPC: the chrome UI can read and set the theme (validated hex colours), ask for candidates for a description (≤ 300 characters, sent to the selected model) and capture its own window (page views are hidden while the picker shows; the image stays in the chrome UI's memory).
- Web content: – (pages are not restyled)

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: fitting-palette-t7q3mw · ADRs: 0016
