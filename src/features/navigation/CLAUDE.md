# navigation – agent notes

- `TOOLBAR_HEIGHT` in `main.ts` must match `--toolbar-height` in `src/app/renderer/styles.css`; change both together.
- Load pages only through `navigation:go` / `toUrl`, never `loadURL` with unchecked input.
- The chrome UI subscribes to `navigation:open-location` after it loads; events sent earlier are lost (e2e helpers retry the click).
