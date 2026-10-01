import { ipcRenderer } from 'electron'
import { channels, type PromptApi } from './ipc'

export const promptBridge: PromptApi = {
  history: () => ipcRenderer.invoke(channels.history),
  record: (entry) => ipcRenderer.invoke(channels.record, entry),
  clearHistory: () => ipcRenderer.invoke(channels.clearHistory),
  onOpen: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(channels.open, wrapped)
    return () => ipcRenderer.off(channels.open, wrapped)
  },
  onToggle: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(channels.toggle, wrapped)
    return () => ipcRenderer.off(channels.toggle, wrapped)
  },
  focusPage: () => ipcRenderer.invoke(channels.focusPage),
}
