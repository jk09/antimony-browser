# 0003. Build the application menu from feature contributions

- Status: Proposed
- Date: 2026-09-30
- Features: navigation (first user), – (app shell)
- Spec: amber-lantern-8qp2hb

## Context
Electron has one application menu per app, set with `Menu.setApplicationMenu`, and replacing it drops Electron's default menu (and with it copy / paste in text fields unless the Edit role is kept). Keyboard shortcuts must be menu accelerators to work while a page has focus (docs/architecture.md), so many features will need menu items. If each feature set the menu itself, the last one would win.

## Options considered
1. **Each feature calls `Menu.setApplicationMenu`** – no shell code. Cons: features overwrite each other; every one must rebuild the standard menus.
2. **Features push items onto `ctx.fileMenu`; the shell builds the menu once after registration** (`src/app/main/menu.ts`) – one owner of the menu, features stay independent, standard menus kept in one place. Cons: only a File menu for now; other menus need a new `MainContext` field.
3. **A menu registry with named sections and ordering** – flexible. Cons: more code than one feature needs today.

## Decision
Option 2. `MainContext.fileMenu` is a plain `MenuItemConstructorOptions[]`; `appMenuTemplate` adds the app menu (macOS), File (feature items, then Close / Quit), Edit, View and Window. Features never call `Menu.setApplicationMenu`.

## Consequences
- Adding a menu item is one `push` in a feature's `register`; order follows `features.ts`.
- Menu items can't be changed after startup (rebuild would be needed); revisit with option 3 once features need other menus, ordering or dynamic items.
