# Architecture

Antimony is a minimal Chromium-based browser built on [Electron](https://www.electronjs.org/) with TypeScript everywhere and React for the browser's own UI. Why this stack: [ADR 0001](./adr/0001-build-on-electron-with-typescript-and-react.md). Why feature slices: [ADR 0002](./adr/0002-organise-code-as-feature-slices-across-processes.md).

## Processes

```
┌──────────────────────────── main process (Node + Electron APIs) ─────────────────────────────┐
│  src/app/main/index.ts   app lifecycle, window, security defaults, registers features        │
│  src/features/*/main.ts  the "backend": page views, navigation, sessions, downloads,         │
│                          permissions, storage (node:sqlite / JSON under userData)            │
└───────────────▲──────────────────────────────────────────────────────┬───────────────────────┘
                │ ctx.ipc.handle (invoke)            ctx.ipc.send (events) │   owns / positions
┌───────────────┴───────────────────────────┐              ┌───────────▼───────────────────────┐
│ chrome UI renderer (React, sandboxed)     │              │ page renderers (sandboxed)        │
│  src/app/renderer, src/features/*/ui      │              │  one WebContentsView per tab      │
│  preload: src/app/preload + */preload.ts  │              │  session "persist:browsing"       │
│  → window.antimony.<feature>              │              │  no preload, no Node, no IPC      │
└───────────────────────────────────────────┘              └───────────────────────────────────┘
```

- **Main process = backend.** Everything with privileges lives here: creating and positioning `WebContentsView`s for pages, navigation, the browsing `session` (cookies, cache, downloads via `will-download`, permission prompts via `setPermissionRequestHandler`, request filtering via `webRequest`), and persistence under `app.getPath('userData')`. Use the built-in `node:sqlite` for history and bookmarks (no native module to rebuild) and JSON files for small settings.
- **Chrome UI = frontend.** The `BrowserWindow`'s own webContents renders the toolbar, tab strip and address bar in React. It has no Node access; it calls `window.antimony.<feature>.*`, which the preload maps to `ipcRenderer.invoke`, and subscribes to events the main process sends.
- **Web pages** are separate `WebContentsView`s added to `window.contentView` and laid out by the main process under the toolbar. They run on their own session partition, get no preload and can reach the app only through normal browser behaviour (navigation, `window.open`, permission requests), which the main process intercepts.

## UI notes

- Layout: the UI reports its toolbar height (or the main process owns a constant) and the main process sets page view bounds on `resize`. Pages sit *above* the chrome UI's webContents, so anything that must overlap a page (menus, the address bar dropdown) needs a native `Menu`, a temporary resize, or a small popup `WebContentsView`.
- Keyboard shortcuts must work while a page has focus: define them as application `Menu` accelerators in the main process (items pushed onto `ctx.fileMenu`, [ADR 0003](./adr/0003-build-the-application-menu-from-feature-contributions.md)) or `before-input-event` on page views, not DOM key handlers in the UI.
- Styling stays plain CSS with custom properties and `prefers-color-scheme`; add a UI library only with an ADR.

## A feature slice

Example: `navigation` (see [src/features/CLAUDE.md](../src/features/CLAUDE.md) for the rules).

```ts
// src/features/navigation/ipc.ts – shared contract, no runtime imports
export const channels = { go: 'navigation:go', stateChanged: 'navigation:state-changed' } as const
export interface NavigationState { url: string; canGoBack: boolean; canGoForward: boolean }
export interface NavigationApi {
  go(input: string): Promise<void>
  onStateChanged(listener: (state: NavigationState) => void): () => void
}

// src/features/navigation/main.ts – main process
export function register({ window, browsingSession, ipc }: MainContext) {
  const page = new WebContentsView({ webPreferences: { ...secureWebPreferences, session: browsingSession } })
  window.contentView.addChildView(page)
  ipc.handle(channels.go, async (input) => {
    if (typeof input !== 'string') throw new TypeError('input must be a string')
    await page.webContents.loadURL(toUrl(input))
  })
  page.webContents.on('did-navigate', () => ipc.send(channels.stateChanged, stateOf(page)))
}

// src/features/navigation/preload.ts – bridge
export const navigationBridge: NavigationApi = {
  go: (input) => ipcRenderer.invoke(channels.go, input),
  onStateChanged: (listener) => {
    const wrapped = (_: unknown, state: NavigationState) => listener(state)
    ipcRenderer.on(channels.stateChanged, wrapped)
    return () => ipcRenderer.off(channels.stateChanged, wrapped)
  },
}

// src/features/navigation/ui/AddressBar.tsx – React, calls window.antimony.navigation
```

Then one line each in `src/app/main/features.ts`, `src/shared/api.ts`, `src/app/preload/index.ts` and `src/app/renderer/App.tsx`.

## Security baseline

Set up in `src/app/main/security.ts` and `src/app/main/ipc.ts`; see the Security rules in [CLAUDE.md](../CLAUDE.md).

- `app.enableSandbox()`, `contextIsolation`, no `nodeIntegration`, no `<webview>`, `window.open` denied unless a feature handles it.
- The chrome UI can only navigate to its own document and has a strict CSP (`index.html`).
- Web content starts with every permission denied; a feature that grants one does it through a spec and an ADR.
- IPC handlers only answer the chrome UI's main frame and receive `unknown` arguments.

## Testing

| Level | Tool | Where | Runs |
|---|---|---|---|
| Unit (main, shared, pure logic) | Vitest, `electron` mocked with `vi.mock` | `*.test.ts` next to the code | `npm test`, anywhere |
| UI components | Vitest + Testing Library, `// @vitest-environment jsdom` | `ui/*.test.tsx` | `npm test`, anywhere |
| End to end | Playwright `_electron` against the built app | `e2e/*.spec.ts` | `npm run test:e2e`, needs the Electron binary and a display (`xvfb-run` on Linux) |

## Suggested feature order

Each is one spec (`spec` skill) and one folder under `src/features/`:

1. **navigation** – address bar (URL or search), one page view, back / forward / reload / stop, loading state, page title in the window title.
2. **tabs** – several page views, tab strip, new / close / switch, `window.open` and middle-click open a tab, keyboard shortcuts.
3. **history** – record visits (`node:sqlite`), address bar suggestions, history page.
4. **bookmarks** – star button, bookmarks bar or menu.
5. **downloads** – `will-download`, progress, open / show in folder.
6. **permissions** – prompt for camera, microphone, notifications, geolocation; remember per site.
7. **find-in-page**, **zoom**, **devtools** toggle, **settings** (home page, search engine).
8. **private windows** (in-memory partition), **session restore**, **content blocking**.
9. Packaging and auto-update (electron-builder, code signing) – a build concern rather than a feature folder.
