# 0007. Hide the menu bar and reach menu items from the prompt

- Status: Accepted
- Date: 2026-10-01
- Features: menu, prompt, navigation, – (app shell)
- Spec: slate-compass-m5t2rw

## Context
On Windows and Linux the application menu (ADR 0003) is a menu bar inside the window, a row taken from the page. Its items must stay reachable, and their accelerators must keep working while a page has focus. Tested on Linux (Electron 44): a menu bar hidden with `setMenuBarVisibility(false)` stops firing its accelerators; with `autoHideMenuBar` they work, but a lone Alt shows the bar again, which shrinks the window's content without a window `resize`.

## Options considered
1. **`setMenuBarVisibility(false)`** – never shows. Cons: accelerators (Ctrl+L, zoom…) stop working on Linux.
2. **`autoHideMenuBar`, Alt reveals it** – native accelerators keep working; Alt gives mouse users the menus (as in Firefox). Cons: the content size changes while it's shown; the page layout must follow.
3. **`autoHideMenuBar` and swallow bare Alt key-downs** (`before-input-event`) – the bar never appears. Cons: pages never see a bare Alt key-down.
4. **No menu, own accelerator handling** – full control. Cons: reimplements Electron's accelerator matching and roles.

## Decision
Option 2 (chosen by the owner). The window is created with `autoHideMenuBar`; the chrome UI re-reports the page area when its viewport changes, so the page view follows the bar. The `menu` feature exposes the live application menu to the chrome UI (`menu:items`, `menu:run`) and the prompt's `/menu` walks it with nested suggestions; items run as if clicked with the page focused.

## Consequences
- Every menu item, including ones features add later, is reachable from `/menu` without extra code.
- The chrome UI can run any visible, enabled menu item over IPC – the same reach as the menu bar.
- If a later Electron keeps accelerators on a hidden menu bar, option 1 or 3 can replace this without touching `menu`.
