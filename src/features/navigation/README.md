# navigation

Owns the tabs: one page view per tab, only the active one laid out in the page area the chrome UI reports. Loads web pages (from the prompt or the assistant), opens links that ask for a new window in a new tab, and tells the UI the active tab's URL, title and loading state.

## Entry points
- UI: `ui/PageArea.tsx` – mounted in `App.tsx`; reports its box to main as page insets (CSS pixels), again on every zoom of the chrome UI and every change of its viewport (the menu bar shown with Alt changes the content size without a window `resize`)
- IPC: `navigation:go|back|forward|reload|stop|set-insets` (UI → main), `navigation:state-changed` (main → UI) – `ipc.ts`; the bridge's `toUrl` runs in the preload, without IPC
- Main: `register` in `main.ts` – owns one `WebContentsView` per tab (the first is created on the first load), keeps only the active tab's view in the window once it has a page, lays it out on `resize` and inset changes (none until the UI reports them), scaling the insets by the chrome UI's zoom factor, focuses it after `navigation:go`, and opens window-open requests in a new tab (`background-tab` stays in the background). Exports `getPage()` (the active tab's controls; agent, history, menu), `getTabs()` (create, activate, close, load, session history; stacks), `setHistoryResolver()` (who decides what back/forward mean; stacks) and `onPageEvent()` (per tab: committed navigations with how they started – typed, link, back/forward, assistant, reload – and how they changed the session history – new, replaced, back, forward –, in-page navigations with the time since the last click or key press, failed loads, title changes, load stops, tabs opened by a page, tab activation)
- Shared: `shared/to-url.ts` – `toUrl` (typed text → http(s) URL or null), `isWebUrl`

## Invariants
- Only `http:` / `https:` URLs are loaded; bare hosts get `https://`, `localhost` and IPs `http://` – `shared/to-url.test.ts`
- `navigation:go` and `getPage().load` validate with `toUrl` in main – `main.test.ts › rejects invalid arguments…`, `› exports page controls that only load web addresses`
- The page can't navigate itself to non-http(s) URLs – `main.test.ts › blocks page navigations to non-web URLs`
- New-window requests (`target="_blank"`, `window.open`, Ctrl/middle-click) never create a window; http(s) ones open a tab with the same web preferences – `main.test.ts › opens new-window links in a new tab…`, `e2e/navigation.spec.ts`
- A history resolver, when set, decides back/forward and `canGoBack`/`canGoForward` – `main.test.ts › lets a history resolver…`
- The page view fills the window minus the reported insets and follows resizes; invalid insets are rejected – `main.test.ts › lays the page view out…`, `› rejects invalid insets`
- Each committed navigation reports how it started; in-page navigations of sub-frames aren't reported – `main.test.ts › tells other features how each navigation started`, `› reports in-page navigations…`
- At any zoom of the chrome UI the page view meets the page area's edges (insets × zoom factor) – `main.test.ts › scales the insets…`, `App.test.tsx › reports the page area again…`, `e2e/prompt.spec.ts › zooming the chrome UI…`

## Dependencies
- Features: – (stacks registers a history resolver)
- App: `secureWebPreferences` (`src/app/main/security.ts`)
- Electron: `WebContentsView`, `navigationHistory`, `input-event` (only clicks, taps and key presses are timed), the `persist:browsing` session
- Stored data: – (the browsing session keeps cookies and cache as Chromium does)

## Security surface
- IPC: `navigation:go` lets the chrome UI load any http(s) URL in the page view; `set-insets` only sizes it.
- Main: `getPage()` gives other features' main code the active tab's `WebContents` (used by the agent, ADR 0004, history, ADR 0006, and menu); `getTabs()` lets stacks create, switch, load and close tabs (ADR 0008); `onPageEvent()` tells them where the tabs go.
- Web content: sandboxed page views on the browsing session, no preload. `window.open` / `target="_blank"` to an http(s) URL opens a new tab without an opener, with or without a user gesture (also from cross-origin iframes); no window is ever created.

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Specs: amber-lantern-8qp2hb, silver-thistle-qk30tb, violet-harbinger-p7w3kd, still-meridian-r4v8nc, brass-lens-z4k9qe, ember-ledger-h3x8vq, slate-compass-m5t2rw, branching-trail-k4w9zp · ADRs: 0003, 0004, 0006, 0008
