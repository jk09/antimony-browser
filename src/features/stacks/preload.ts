import { ipcRenderer } from 'electron'
import { channels, type StackCommand, type StacksApi, type StacksState } from './ipc'

export const stacksBridge: StacksApi = {
  state: () => ipcRenderer.invoke(channels.state),
  goToNode: (nodeId) => ipcRenderer.invoke(channels.goToNode, nodeId),
  switch: (stackId) => ipcRenderer.invoke(channels.switch, stackId),
  create: () => ipcRenderer.invoke(channels.create),
  close: (stackId) => ipcRenderer.invoke(channels.close, stackId),
  outline: (name) => ipcRenderer.invoke(channels.outline, name),
  closeNode: (nodeId) => ipcRenderer.invoke(channels.closeNode, nodeId),
  home: () => ipcRenderer.invoke(channels.home),
  setHome: (url) => ipcRenderer.invoke(channels.setHome, url),
  setMuted: (stackId, muted) => ipcRenderer.invoke(channels.setMuted, { stackId, muted }),
  onChanged: (listener) => {
    const wrapped = (_: unknown, state: StacksState) => listener(state)
    ipcRenderer.on(channels.stateChanged, wrapped)
    return () => ipcRenderer.off(channels.stateChanged, wrapped)
  },
  onCommand: (listener) => {
    const wrapped = (_: unknown, command: StackCommand) => listener(command)
    ipcRenderer.on(channels.command, wrapped)
    return () => ipcRenderer.off(channels.command, wrapped)
  },
}
