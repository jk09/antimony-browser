import { ipcRenderer } from 'electron'
import { channels, type AppearanceApi, type OpenRequest, type Theme } from './ipc'

const subscribe =
  <T>(channel: string) =>
  (listener: (payload: T) => void) => {
    const wrapped = (_: unknown, payload: T) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.off(channel, wrapped)
    }
  }

export const appearanceBridge: AppearanceApi = {
  get: () => ipcRenderer.invoke(channels.get),
  set: (theme) => ipcRenderer.invoke(channels.set, theme),
  onChanged: subscribe<Theme | null>(channels.changed),
  generate: (description) => ipcRenderer.invoke(channels.generate, description),
  capture: () => ipcRenderer.invoke(channels.capture),
  requestOpen: (request) => ipcRenderer.invoke(channels.requestOpen, request),
  onOpen: subscribe<OpenRequest>(channels.open),
}
