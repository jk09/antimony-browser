# navigation – agent notes

- Load pages only through `navigation:go` / `getPage().load` / `toUrl`, never `loadURL` with unchecked input.
- The page view sits above the chrome UI: anything that must be visible (assistant panel, debugger) changes the page area's box, and `PageArea` reports it as insets.
