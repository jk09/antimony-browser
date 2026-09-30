import { contextBridge } from 'electron'
import { agentBridge } from '../../features/agent/preload'
import { navigationBridge } from '../../features/navigation/preload'
import { promptBridge } from '../../features/prompt/preload'
import { skillsBridge } from '../../features/skills/preload'
import type { AntimonyApi } from '../../shared/api'

// Features add their bridge here, one key each (see src/features/CLAUDE.md).
const api: AntimonyApi = {
  versions: { chrome: process.versions.chrome, electron: process.versions.electron },
  agent: agentBridge,
  navigation: navigationBridge,
  prompt: promptBridge,
  skills: skillsBridge,
}

contextBridge.exposeInMainWorld('antimony', api)
