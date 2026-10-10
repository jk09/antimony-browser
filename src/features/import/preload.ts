import { ipcRenderer } from 'electron'
import { channels, type ImportApi } from './ipc'

export const importBridge: ImportApi = {
  choose: () => ipcRenderer.invoke(channels.choose),
  run: (path) => ipcRenderer.invoke(channels.run, path),
}
