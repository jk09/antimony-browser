import { ipcRenderer } from 'electron'
import { channels, type Skill, type SkillsApi } from './ipc'

export const skillsBridge: SkillsApi = {
  list: () => ipcRenderer.invoke(channels.list),
  onListChanged: (listener) => {
    const wrapped = (_: unknown, skills: Skill[]) => listener(skills)
    ipcRenderer.on(channels.listChanged, wrapped)
    return () => ipcRenderer.off(channels.listChanged, wrapped)
  },
  draft: () => ipcRenderer.invoke(channels.draft),
  save: (draft) => ipcRenderer.invoke(channels.save, draft),
  delete: (name) => ipcRenderer.invoke(channels.delete, name),
  run: (name, args) => ipcRenderer.invoke(channels.run, name, args),
  requestSave: (name) => ipcRenderer.invoke(channels.requestSave, name),
  onSaveRequested: (listener) => {
    const wrapped = (_: unknown, name: string) => listener(name)
    ipcRenderer.on(channels.saveRequested, wrapped)
    return () => ipcRenderer.off(channels.saveRequested, wrapped)
  },
}
