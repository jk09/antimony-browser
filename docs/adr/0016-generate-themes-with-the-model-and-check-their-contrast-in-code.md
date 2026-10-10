# 0016. Generate themes from a usability need with the model, check their contrast in code, and show real window captures

- Status: Accepted
- Date: 2026-10-10
- Features: appearance, welcome, prompt
- Spec: fitting-palette-t7q3mw

## Context
Users with astigmatism, light sensitivity, low vision, dyslexia or colour-vision deficiency need different colours for the browser's own UI, and usually can't name them. The owner asked for themes described by usability need, based on UI usability research such as WCAG, shown as screenshots to choose from, and changeable later with `/settings`.

## Options considered
1. **Model generates, code checks** – any need the user can describe; the model applies built-in guidance, and Antimony computes WCAG contrast and repairs or drops failing colours. Results vary between runs; one model request per search.
2. **Curated presets only** – predictable and reviewed, but only the needs someone foresaw; no "warm and calm for reading at night".
3. **Presets plus generated** – both, at the cost of maintaining the presets as well.
For previews: **real captures** of the window with each candidate applied (truest picture, a brief flicker) versus **rendered mockups** (no flicker, but not the real UI).

## Decision
Option 1 with real captures, as the owner chose:
- A theme is `#rrggbb` values for the chrome UI's colour tokens plus a light/dark scheme; model output is parsed as data, never as CSS. Every theme is checked against WCAG 2.2 AA (4.5:1 text, 3:1 focus rings, borders and chart colours) and repaired by moving lightness only, in main for stored and set themes and for every candidate.
- Only the user's description and the token names go to the selected model, through `complete` (the user's Claude Code CLI, ADR 0015).
- Each candidate is applied to the chrome UI over a sample scene and captured with `webContents.capturePage` (the chrome UI only; page views are hidden while the picker shows); the stored theme is restored afterwards.
- Themes change Antimony's own UI only; web pages are not restyled or told a preferred scheme.

## Consequences
- Any described need gets candidates, but quality depends on the model; contrast is guaranteed by code, not by the model.
- The window flickers through the candidates for about a second while capturing.
- A theme cannot make text larger or change spacing (Ctrl/Cmd + / − zoom still does); that would need the stylesheet's fixed sizes reworked.
- Restyling web pages would touch the web-content security model and need its own ADR.
