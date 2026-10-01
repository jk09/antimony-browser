import type { BrowserWindow, MenuItemConstructorOptions, Session } from 'electron'
import { register as agent } from '../../features/agent/main'
import { register as history } from '../../features/history/main'
import { register as navigation } from '../../features/navigation/main'
import { register as prompt } from '../../features/prompt/main'
import { register as skills } from '../../features/skills/main'
import type { ChromeUiIpc } from './ipc'

/** What a feature's main-process side gets at startup. */
export interface MainContext {
  /** The browser window. Its own webContents is the chrome UI (src/app/renderer). */
  window: BrowserWindow
  /** Session for web content, separate from the chrome UI's default session. */
  browsingSession: Session
  /** Sender-checked IPC with the chrome UI. Use this, not ipcMain directly. */
  ipc: ChromeUiIpc
  /**
   * Items for the application menu's File menu. The app builds the menu once every feature is
   * registered (src/app/main/menu.ts); features never call Menu.setApplicationMenu themselves.
   */
  fileMenu: MenuItemConstructorOptions[]
}

/** A feature's main-process entry point (`register` in src/features/<feature>/main.ts). */
export type RegisterFeature = (ctx: MainContext) => void | Promise<void>

// One entry per feature, sorted by name. Removing a feature removes its entry.
export const features: RegisterFeature[] = [agent, history, navigation, prompt, skills]
