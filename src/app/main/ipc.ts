import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

/** IPC between the main process and the chrome UI, handed to features via MainContext. */
export interface ChromeUiIpc {
  /**
   * Handles `ipcRenderer.invoke(channel, ...args)` from the chrome UI. Calls from any other
   * WebContents or frame are rejected. Arguments arrive as `unknown`: validate before use.
   */
  handle(channel: string, handler: (...args: unknown[]) => unknown): void
  /** Sends an event to the chrome UI; dropped if the window is gone. */
  send(channel: string, payload: unknown): void
}

export function isFromChromeUi(event: IpcMainInvokeEvent, chromeUi: WebContents): boolean {
  return event.sender === chromeUi && event.senderFrame != null && event.senderFrame.parent === null
}

export function createChromeUiIpc(chromeUi: WebContents): ChromeUiIpc {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!isFromChromeUi(event, chromeUi)) {
          throw new Error(`Rejected ${channel}: not sent by the chrome UI`)
        }
        return handler(...args)
      })
    },
    send(channel, payload) {
      if (!chromeUi.isDestroyed()) chromeUi.send(channel, payload)
    },
  }
}
