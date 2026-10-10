import { ipcRenderer } from 'electron'
import {
  channels,
  type AgentApi,
  type AgentSettings,
  type AgentState,
  type DebugEvent,
} from './ipc'

const subscribe =
  <T>(channel: string) =>
  (listener: (payload: T) => void) => {
    const wrapped = (_: unknown, payload: T) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.off(channel, wrapped)
    }
  }

export const agentBridge: AgentApi = {
  run: (input) => ipcRenderer.invoke(channels.run, input),
  stop: () => ipcRenderer.invoke(channels.stop),
  approve: (decision) => ipcRenderer.invoke(channels.approve, decision),
  newConversation: () => ipcRenderer.invoke(channels.newConversation),
  state: () => ipcRenderer.invoke(channels.state),
  onStateChanged: subscribe<AgentState>(channels.stateChanged),
  settings: () => ipcRenderer.invoke(channels.settings),
  updateSettings: (update) => ipcRenderer.invoke(channels.updateSettings, update),
  onSettingsChanged: subscribe<AgentSettings>(channels.settingsChanged),
  checkCli: () => ipcRenderer.invoke(channels.checkCli),
  debugLog: () => ipcRenderer.invoke(channels.debugLog),
  onDebugEvent: (listener) =>
    subscribe<{ event: DebugEvent; label: string }>(channels.debugLogChanged)(({ event, label }) =>
      listener(event, label),
    ),
  toggleDebug: () => ipcRenderer.invoke(channels.toggleDebug),
  onDebugToggled: (listener) => subscribe<null>(channels.debugToggled)(() => listener()),
}
