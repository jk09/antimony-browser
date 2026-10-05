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
}
