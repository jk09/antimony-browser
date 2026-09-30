import { contextBridge } from 'electron'
import type { AntimonyApi } from '../../shared/api'

// Features add their bridge here, one key each (see src/features/CLAUDE.md).
const api: AntimonyApi = {
  versions: { chrome: process.versions.chrome, electron: process.versions.electron },
}

contextBridge.exposeInMainWorld('antimony', api)
