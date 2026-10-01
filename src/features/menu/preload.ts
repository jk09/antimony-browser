import { ipcRenderer } from 'electron'
import { channels, type MenuApi } from './ipc'

export const menuBridge: MenuApi = {
  items: () => ipcRenderer.invoke(channels.items),
  run: (path) => ipcRenderer.invoke(channels.run, path),
}
