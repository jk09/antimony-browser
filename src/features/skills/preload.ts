import { ipcRenderer } from 'electron'
import { channels, type Skill, type SkillsApi } from './ipc'

export const skillsBridge: SkillsApi = {
  list: () => ipcRenderer.invoke(channels.list),
  onListChanged: (listener) => {
    const wrapped = (_: unknown, skills: Skill[]) => listener(skills)
    ipcRenderer.on(channels.listChanged, wrapped)
    return () => ipcRenderer.off(channels.listChanged, wrapped)
  },
  delete: (name) => ipcRenderer.invoke(channels.delete, name),
  run: (name, args) => ipcRenderer.invoke(channels.run, name, args),
  requestOpen: () => ipcRenderer.invoke(channels.requestOpen),
  onOpen: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(channels.open, wrapped)
    return () => ipcRenderer.off(channels.open, wrapped)
  },
}
