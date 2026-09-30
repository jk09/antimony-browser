import { ipcRenderer } from 'electron'
import { channels, type NavigationApi, type NavigationState } from './ipc'
import { toUrl } from './shared/to-url'

export const navigationBridge: NavigationApi = {
  go: (url) => ipcRenderer.invoke(channels.go, url),
  back: () => ipcRenderer.invoke(channels.back),
  forward: () => ipcRenderer.invoke(channels.forward),
  reload: () => ipcRenderer.invoke(channels.reload),
  stop: () => ipcRenderer.invoke(channels.stop),
  setInsets: (insets) => ipcRenderer.invoke(channels.setInsets, insets),
  onStateChanged: (listener) => {
    const wrapped = (_: unknown, state: NavigationState) => listener(state)
    ipcRenderer.on(channels.stateChanged, wrapped)
    return () => ipcRenderer.off(channels.stateChanged, wrapped)
  },
  toUrl,
}
