# <feature>

<One or two sentences: what this feature does for the user of the browser.>

## Entry points
- UI: `ui/AddressBar.tsx` – mounted in the toolbar (`App.tsx`)
- IPC: `navigation:go` (UI → main), `navigation:state-changed` (main → UI) – `ipc.ts`
- Main: `register` in `main.ts` – handles `did-navigate` on page views

## Invariants
- <Rule that must never break> – covered by `<file> › <test name>`

## Dependencies
- Features: <other feature> (via `<its ipc.ts type or main.ts export>`)
- Electron: <session, webContents, protocol, …>
- Stored data: <file or table under userData, or –>

## Security surface
- <IPC exposed to the chrome UI, permissions or capabilities granted to web content, or –>

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: <spec-id or –> · ADRs: <NNNN, …>
