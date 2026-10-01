# menu

Lets you run any application menu item from the prompt with `/menu`, picking the menu and then the item with suggestions at each level (`/menu view zoom-in`), so the window needs no menu bar: on Windows and Linux it stays hidden until Alt.

## Entry points
- IPC: `menu:items` (UI → main, the menu as a tree of `MenuEntry`), `menu:run` (UI → main, a path of names) – `ipc.ts`
- Main: `register` in `main.ts` – reads `Menu.getApplicationMenu()` on every call (visible items only, no separators) and runs an item with `MenuItem.click`, targeting the page's `WebContents` (or the chrome UI before the first page), as if clicked with the page focused
- Shared: `shared/names.ts` – label → name (`Open Location…` → `open-location`, repeats get `-2`), accelerator display per platform, path resolution with the choices at each level
- UI: none of its own; prompt's `/menu` command (`prompt/ui/commands.ts`) and nested suggestions (`prompt/shared/suggest.ts`) use the bridge
- App: the window is created with `autoHideMenuBar` (`src/app/main/index.ts`)

## Invariants
- The menu bar is hidden at start, its accelerators still work, and Alt shows it without the page view overlapping it – `e2e/prompt.spec.ts › the menu bar is hidden…`
- Only visible, enabled leaf items run; unknown names and submenu paths list the choices instead – `main.test.ts`, `shared/names.test.ts`
- `menu:run` takes 1–8 non-empty names of at most 100 characters – `main.test.ts › rejects malformed paths`
- Items run against the page when there is one – `main.test.ts › runs an item as if clicked…`

## Dependencies
- Features: navigation (`getPage().contents()` from its `main.ts`); prompt calls this feature's bridge
- Electron: `Menu`, `MenuItem.click`; the menu itself is built by the app shell (`src/app/main/menu.ts`, ADR 0003)
- Stored data: –

## Security surface
- IPC: the chrome UI can run any visible, enabled application menu item – no more than clicking the menu bar could. Web content: –

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: slate-compass-m5t2rw · ADRs: 0003, 0007
