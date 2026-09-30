import type { NavigationApi } from '../features/navigation/ipc'

/**
 * The API the preload script exposes to the chrome UI as `window.antimony`.
 * Each feature adds one key, typed by the interface in its `ipc.ts`.
 */
export interface AntimonyApi {
  /** Versions of the embedded runtimes. */
  versions: { chrome: string; electron: string }
  navigation: NavigationApi
}
