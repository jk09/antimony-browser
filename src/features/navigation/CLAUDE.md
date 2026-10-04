# navigation – agent notes

- Load pages only through `navigation:go` / `getPage().load` / `toUrl`, never `loadURL` with unchecked input.
- The page view sits above the chrome UI: anything that must be visible (assistant panel, debugger) changes the page area's box, and `PageArea` reports it as insets.
- Insets are the chrome UI's CSS pixels; main multiplies them by its zoom factor. Anything else mapping chrome UI coordinates onto views must do the same.
- Start navigations through `open(url, transition)` (or set `pending`) so `onPageEvent` reports how they started; anything else is reported as a link.
- Per-tab state (pending transition, input time, session-history index) lives on the `Tab` record; every `PageEvent` carries its `tabId`, and listeners that care about the visible page check `getTabs().active()`.
- Back/forward go through the history resolver when one is set (stacks); don't call `navigationHistory.goBack/goForward` elsewhere.
- A `prepare`d tab's events are held until it is first activated: listeners see its whole load at once, after `activated`.
