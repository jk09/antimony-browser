import { ipcRenderer } from 'electron'
import { channels, type FeedbackApi } from './ipc'

export const feedbackBridge: FeedbackApi = {
  send: (text) => ipcRenderer.invoke(channels.send, text),
}
