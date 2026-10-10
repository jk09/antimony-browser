import { ipcRenderer } from 'electron'
import { channels, type WelcomeApi } from './ipc'

export const welcomeBridge: WelcomeApi = {
  state: () => ipcRenderer.invoke(channels.state),
  setDone: (done) => ipcRenderer.invoke(channels.setDone, done),
  requestOpen: () => ipcRenderer.invoke(channels.requestOpen),
  onOpen: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(channels.open, wrapped)
    return () => ipcRenderer.off(channels.open, wrapped)
  },
}
