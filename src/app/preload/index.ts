import { contextBridge } from 'electron'
import { navigationBridge } from '../../features/navigation/preload'
import type { AntimonyApi } from '../../shared/api'

// Features add their bridge here, one key each (see src/features/CLAUDE.md).
const api: AntimonyApi = {
  versions: { chrome: process.versions.chrome, electron: process.versions.electron },
  navigation: navigationBridge,
}

contextBridge.exposeInMainWorld('antimony', api)
