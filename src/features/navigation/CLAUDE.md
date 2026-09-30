# navigation – agent notes

- `TOOLBAR_HEIGHT` in `main.ts` must match `--toolbar-height` in `src/app/renderer/styles.css`; change both together. It's only the top inset until `PageArea` reports the real one.
- Load pages only through `navigation:go` / `getPage().load` / `toUrl`, never `loadURL` with unchecked input.
- The page view sits above the chrome UI: anything that must be visible (prompt card, debugger) changes the page area's box, and `PageArea` reports it as insets.
