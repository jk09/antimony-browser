import { ipcRenderer } from 'electron'
import { channels, type NavigationApi } from './ipc'

export const navigationBridge: NavigationApi = {
  go: (url) => ipcRenderer.invoke(channels.go, url),
  onOpenLocation: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(channels.openLocation, wrapped)
    return () => ipcRenderer.off(channels.openLocation, wrapped)
  },
}
