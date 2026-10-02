import { ipcRenderer } from 'electron'
import { channels, type StacksApi, type StacksState } from './ipc'

export const stacksBridge: StacksApi = {
  state: () => ipcRenderer.invoke(channels.state),
  goToNode: (nodeId) => ipcRenderer.invoke(channels.goToNode, nodeId),
  switch: (stackId) => ipcRenderer.invoke(channels.switch, stackId),
  create: () => ipcRenderer.invoke(channels.create),
  close: (stackId) => ipcRenderer.invoke(channels.close, stackId),
  outline: (name) => ipcRenderer.invoke(channels.outline, name),
  settings: () => ipcRenderer.invoke(channels.settings),
  updateSettings: (settings) => ipcRenderer.invoke(channels.updateSettings, settings),
  onChanged: (listener) => {
    const wrapped = (_: unknown, state: StacksState) => listener(state)
    ipcRenderer.on(channels.stateChanged, wrapped)
    return () => ipcRenderer.off(channels.stateChanged, wrapped)
  },
}
