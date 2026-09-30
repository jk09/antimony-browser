# Feature slices

One folder per feature (`kebab-case`), all processes together:

| File | Process | Contains |
|---|---|---|
| `ipc.ts` | shared | Channel names, payload types, the bridge interface (`<Feature>Api`). No runtime imports. |
| `main.ts` | main | `export function register(ctx: MainContext)`: IPC handlers, views, session hooks. |
| `preload.ts` | preload | `export const <feature>Bridge: <Feature>Api`, thin `ipcRenderer` wrappers only. |
| `ui/` | renderer | React components and hooks; call `window.antimony.<feature>`. |
| `*.test.ts(x)` | – | Unit tests next to the code; UI tests start with `// @vitest-environment jsdom`. |

- Register a new feature in four places, one line each: `src/app/main/features.ts`, `src/shared/api.ts`, `src/app/preload/index.ts`, and where its UI mounts in `src/app/renderer/App.tsx`.
- Channel names: `<feature>:<verb>` (`navigation:go`); main → UI events: `<feature>:<noun>-changed`.
- ESLint enforces the process boundaries; don't disable those rules.
- Another feature's code may be used only through its `ipc.ts` types or functions exported from its `main.ts`; list it under Dependencies in the README.
