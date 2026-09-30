import type { BrowserWindow, Session } from 'electron'
import type { ChromeUiIpc } from './ipc'

/** What a feature's main-process side gets at startup. */
export interface MainContext {
  /** The browser window. Its own webContents is the chrome UI (src/app/renderer). */
  window: BrowserWindow
  /** Session for web content, separate from the chrome UI's default session. */
  browsingSession: Session
  /** Sender-checked IPC with the chrome UI. Use this, not ipcMain directly. */
  ipc: ChromeUiIpc
}

/** A feature's main-process entry point (`register` in src/features/<feature>/main.ts). */
export type RegisterFeature = (ctx: MainContext) => void | Promise<void>

// One entry per feature, sorted by name. Removing a feature removes its entry.
export const features: RegisterFeature[] = []
