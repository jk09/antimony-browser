# navigation

Owns the page view: loads web pages (from the prompt or the assistant), keeps it laid out in the page area the chrome UI reports, and tells the UI the current URL, title and loading state. Links that ask for a new window open in that same page view, since there are no tabs yet.

## Entry points
- UI: `ui/PageArea.tsx` – mounted in `App.tsx`; reports its box to main as page insets (CSS pixels), again on every zoom of the chrome UI
- IPC: `navigation:go|back|forward|reload|stop|set-insets` (UI → main), `navigation:state-changed` (main → UI) – `ipc.ts`; the bridge's `toUrl` runs in the preload, without IPC
- Main: `register` in `main.ts` – owns the page `WebContentsView`, adds it on the first load, lays it out on `resize` and inset changes (none until the UI reports them), scaling the insets by the chrome UI's zoom factor, focuses it after `navigation:go`, and sets the page's window-open handler; exports `getPage()` (page controls for the agent and history) and `onPageEvent()` (committed navigations with how they started – typed, link, back/forward, assistant, reload –, in-page navigations with the time since the last click or key press in the page, title changes, load stops; for history)
- Shared: `shared/to-url.ts` – `toUrl` (typed text → http(s) URL or null), `isWebUrl`

## Invariants
- Only `http:` / `https:` URLs are loaded; bare hosts get `https://`, `localhost` and IPs `http://` – `shared/to-url.test.ts`
- `navigation:go` and `getPage().load` validate with `toUrl` in main – `main.test.ts › rejects invalid arguments…`, `› exports page controls that only load web addresses`
- The page can't navigate itself to non-http(s) URLs – `main.test.ts › blocks page navigations to non-web URLs`
- New-window requests (`target="_blank"`, `window.open`) never create a window; http(s) ones load in the page view – `main.test.ts › opens new-window links…`, `e2e/navigation.spec.ts`
- The page view fills the window minus the reported insets and follows resizes; invalid insets are rejected – `main.test.ts › lays the page view out…`, `› rejects invalid insets`
- Each committed navigation reports how it started; in-page navigations of sub-frames aren't reported – `main.test.ts › tells other features how each navigation started`, `› reports in-page navigations…`
- At any zoom of the chrome UI the page view meets the page area's edges (insets × zoom factor) – `main.test.ts › scales the insets…`, `App.test.tsx › reports the page area again…`, `e2e/prompt.spec.ts › zooming the chrome UI…`

## Dependencies
- Features: –
- App: `secureWebPreferences` (`src/app/main/security.ts`)
- Electron: `WebContentsView`, `navigationHistory`, `input-event` (only clicks, taps and key presses are timed), the `persist:browsing` session
- Stored data: – (the browsing session keeps cookies and cache as Chromium does)

## Security surface
- IPC: `navigation:go` lets the chrome UI load any http(s) URL in the page view; `set-insets` only sizes it.
- Main: `getPage()` gives other features' main code the page `WebContents` (used by the agent, ADR 0004, and history, ADR 0006); `onPageEvent()` tells them where the page goes.
- Web content: one sandboxed page view on the browsing session, no preload. `window.open` / `target="_blank"` to an http(s) URL navigates the page view, with or without a user gesture (also from cross-origin iframes); no window is ever created.

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Specs: amber-lantern-8qp2hb, silver-thistle-qk30tb, violet-harbinger-p7w3kd, still-meridian-r4v8nc, brass-lens-z4k9qe, ember-ledger-h3x8vq · ADRs: 0003, 0004, 0006
