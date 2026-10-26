import { ipcRenderer } from 'electron'
import { channels, type LinkSummariesApi, type LinkSummariesSettings } from './ipc'

export const linkSummariesBridge: LinkSummariesApi = {
  settings: () => ipcRenderer.invoke(channels.settings),
  updateSettings: (update) => ipcRenderer.invoke(channels.updateSettings, update),
  onSettingsChanged: (listener) => {
    const wrapped = (_: unknown, settings: LinkSummariesSettings) => listener(settings)
    ipcRenderer.on(channels.settingsChanged, wrapped)
    return () => ipcRenderer.off(channels.settingsChanged, wrapped)
  },
}
