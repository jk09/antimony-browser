import { ipcRenderer } from 'electron'
import {
  channels,
  type HistoryApi,
  type HistorySettings,
  type OpenRequest,
  type RecallShown,
} from './ipc'

export const historyBridge: HistoryApi = {
  suggest: (text) => ipcRenderer.invoke(channels.suggest, text),
  search: (request) => ipcRenderer.invoke(channels.search, request),
  screenshot: (id) => ipcRenderer.invoke(channels.screenshot, id),
  current: () => ipcRenderer.invoke(channels.current),
  setNote: (id, note) => ipcRenderer.invoke(channels.setNote, id, note),
  delete: (id) => ipcRenderer.invoke(channels.delete, id),
  clear: (all) => ipcRenderer.invoke(channels.clear, all),
  settings: () => ipcRenderer.invoke(channels.settings),
  updateSettings: (update) => ipcRenderer.invoke(channels.updateSettings, update),
  requestOpen: (request) => ipcRenderer.invoke(channels.requestOpen, request),
  onOpen: (listener) => {
    const wrapped = (_: unknown, request: OpenRequest) => listener(request)
    ipcRenderer.on(channels.open, wrapped)
    return () => ipcRenderer.off(channels.open, wrapped)
  },
  recall: (request) => ipcRenderer.invoke(channels.recall, request),
  cancelRecall: () => ipcRenderer.invoke(channels.cancelRecall),
  requestRecall: (query) => ipcRenderer.invoke(channels.requestRecall, query),
  onOpenRecall: (listener) => {
    const wrapped = (_: unknown, query: string) => listener(query)
    ipcRenderer.on(channels.openRecall, wrapped)
    return () => ipcRenderer.off(channels.openRecall, wrapped)
  },
  onRecallShown: (listener) => {
    const wrapped = (_: unknown, shown: RecallShown) => listener(shown)
    ipcRenderer.on(channels.recallShown, wrapped)
    return () => ipcRenderer.off(channels.recallShown, wrapped)
  },
  onChanged: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(channels.changed, wrapped)
    return () => ipcRenderer.off(channels.changed, wrapped)
  },
  onSettingsChanged: (listener) => {
    const wrapped = (_: unknown, settings: HistorySettings) => listener(settings)
    ipcRenderer.on(channels.settingsChanged, wrapped)
    return () => ipcRenderer.off(channels.settingsChanged, wrapped)
  },
}
