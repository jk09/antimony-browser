# navigation

Opens a web page: File → Open Location… (Ctrl/Cmd+L) shows a text box in the toolbar, and Enter loads the typed address in the page view under the toolbar. Links that ask for a new window open in that same page view, since there are no tabs yet.

## Entry points
- UI: `ui/OpenLocation.tsx` – mounted in the toolbar (`App.tsx`); hidden until requested, Escape hides it
- IPC: `navigation:go` (UI → main, one URL string), `navigation:open-location` (main → UI, no payload) – `ipc.ts`
- Main: `register` in `main.ts` – owns the page `WebContentsView`, adds it on the first load, lays it out on `resize`, contributes the File menu item via `ctx.fileMenu`, and sets the page's window-open handler
- Shared: `shared/to-url.ts` – `toUrl` (typed text → http(s) URL or null), `isWebUrl`

## Invariants
- Only `http:` / `https:` URLs are loaded; bare hosts get `https://`, `localhost` and IPs `http://` – `shared/to-url.test.ts`
- `navigation:go` validates its argument with `toUrl` again in main – `main.test.ts › rejects invalid arguments to navigation:go`
- The page can't navigate itself to non-http(s) URLs – `main.test.ts › blocks page navigations to non-web URLs`
- New-window requests (`target="_blank"`, `window.open`) never create a window; http(s) ones load in the page view – `main.test.ts › opens new-window links in the page view…`, `e2e/navigation.spec.ts`
- The page view never covers the toolbar and follows window resizes – `main.test.ts › resizes the page view with the window`
- Invalid input shows an error and loads nothing – `ui/OpenLocation.test.tsx`, `e2e/navigation.spec.ts`

## Dependencies
- Features: –
- App: `secureWebPreferences` (`src/app/main/security.ts`), `ctx.fileMenu` (`src/app/main/menu.ts`, ADR 0003)
- Electron: `WebContentsView`, `Menu` (through `ctx.fileMenu`), the `persist:browsing` session
- Stored data: – (the browsing session keeps cookies and cache as Chromium does)

## Security surface
- IPC: `navigation:go` lets the chrome UI load any http(s) URL in the page view.
- Web content: one sandboxed page view on the browsing session, no preload. `window.open` / `target="_blank"` to an http(s) URL navigates the page view, with or without a user gesture (also from cross-origin iframes); no window is ever created.

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Specs: amber-lantern-8qp2hb, silver-thistle-qk30tb · ADRs: 0003
