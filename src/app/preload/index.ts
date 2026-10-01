import { contextBridge } from 'electron'
import { agentBridge } from '../../features/agent/preload'
import { historyBridge } from '../../features/history/preload'
import { menuBridge } from '../../features/menu/preload'
import { navigationBridge } from '../../features/navigation/preload'
import { promptBridge } from '../../features/prompt/preload'
import { skillsBridge } from '../../features/skills/preload'
import { stacksBridge } from '../../features/stacks/preload'
import type { AntimonyApi } from '../../shared/api'

// Features add their bridge here, one key each (see src/features/CLAUDE.md).
const api: AntimonyApi = {
  versions: { chrome: process.versions.chrome, electron: process.versions.electron },
  agent: agentBridge,
  history: historyBridge,
  menu: menuBridge,
  navigation: navigationBridge,
  prompt: promptBridge,
  skills: skillsBridge,
  stacks: stacksBridge,
}

contextBridge.exposeInMainWorld('antimony', api)
