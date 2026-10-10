import {
  DEFAULT_MODEL,
  isModelId,
  type AgentSettings,
  type ModelId,
  type SettingsUpdate,
} from '../ipc'

export type StoredSettings = AgentSettings

export const defaultSettings = (): StoredSettings => ({
  model: DEFAULT_MODEL,
  pageAccess: false,
  historyAccess: true,
})

/**
 * The model a stored id names: `cli:<id>` (saved when the CLI was one of several backends) is that
 * Claude model; anything else unknown (Ollama models) is the default.
 */
function storedModel(value: unknown): ModelId {
  const id = typeof value === 'string' ? value.replace(/^cli:/, '') : value
  return isModelId(id) ? id : DEFAULT_MODEL
}

/** Reads stored settings; fields of removed backends (the API key) are dropped. */
export function parseSettings(raw: unknown): StoredSettings {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('settings must be an object')
  const record = raw as Record<string, unknown>
  return {
    model: storedModel(record['model']),
    pageAccess: record['pageAccess'] === true,
    // Settings saved before the option existed keep history search on.
    historyAccess: record['historyAccess'] !== false,
  }
}

/** Throws unless `value` is a settings update from the UI. */
export function parseUpdate(value: unknown): SettingsUpdate {
  if (typeof value !== 'object' || value === null) throw new TypeError('expected a settings object')
  const record = value as Record<string, unknown>
  const update: SettingsUpdate = {}
  for (const key of Object.keys(record)) {
    if (key !== 'model' && key !== 'pageAccess' && key !== 'historyAccess')
      throw new TypeError(`unknown setting ${key}`)
  }
  if ('model' in record) {
    if (!isModelId(record['model'])) throw new TypeError('unknown model')
    update.model = record['model']
  }
  if ('pageAccess' in record) {
    if (typeof record['pageAccess'] !== 'boolean')
      throw new TypeError('pageAccess must be a boolean')
    update.pageAccess = record['pageAccess']
  }
  if ('historyAccess' in record) {
    if (typeof record['historyAccess'] !== 'boolean') {
      throw new TypeError('historyAccess must be a boolean')
    }
    update.historyAccess = record['historyAccess']
  }
  return update
}
