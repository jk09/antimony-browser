# navigation

Opens a web page: File → Open Location… (Ctrl/Cmd+L) shows a text box in the toolbar, and Enter loads the typed address in the page view under the toolbar.

## Entry points
- UI: `ui/OpenLocation.tsx` – mounted in the toolbar (`App.tsx`); hidden until requested, Escape hides it
- IPC: `navigation:go` (UI → main, one URL string), `navigation:open-location` (main → UI, no payload) – `ipc.ts`
- Main: `register` in `main.ts` – owns the page `WebContentsView`, adds it on the first load, lays it out on `resize`, contributes the File menu item via `ctx.fileMenu`
- Shared: `shared/to-url.ts` – `toUrl` (typed text → http(s) URL or null), `isWebUrl`

## Invariants
- Only `http:` / `https:` URLs are loaded; bare hosts get `https://`, `localhost` and IPs `http://` – `shared/to-url.test.ts`
- `navigation:go` validates its argument with `toUrl` again in main – `main.test.ts › rejects invalid arguments to navigation:go`
- The page can't navigate itself to non-http(s) URLs – `main.test.ts › blocks page navigations to non-web URLs`
- The page view never covers the toolbar and follows window resizes – `main.test.ts › resizes the page view with the window`
- Invalid input shows an error and loads nothing – `ui/OpenLocation.test.tsx`, `e2e/navigation.spec.ts`

## Dependencies
- Features: –
- App: `secureWebPreferences` (`src/app/main/security.ts`), `ctx.fileMenu` (`src/app/main/menu.ts`, ADR 0003)
- Electron: `WebContentsView`, `Menu` (through `ctx.fileMenu`), the `persist:browsing` session
- Stored data: – (the browsing session keeps cookies and cache as Chromium does)

## Security surface
- IPC: `navigation:go` lets the chrome UI load any http(s) URL in the page view.
- Web content: one sandboxed page view on the browsing session, no preload; `window.open` stays denied (app default).

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: amber-lantern-8qp2hb · ADRs: 0003
