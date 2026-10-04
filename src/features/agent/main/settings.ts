import type { JsonStore } from '../../../app/main/json-store'
import {
  isModelId,
  providerOf,
  type AgentSettings,
  type ModelId,
  type SettingsUpdate,
} from '../ipc'

export interface StoredSettings {
  model: ModelId
  pageAccess: boolean
  historyAccess: boolean
  /** The API key encrypted with safeStorage, base64. */
  encryptedKey?: string
}

export const defaultSettings = (): StoredSettings => ({
  model: 'claude-sonnet-5-5',
  pageAccess: false,
  historyAccess: true,
})

export function parseSettings(raw: unknown): StoredSettings {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('settings must be an object')
  const record = raw as Record<string, unknown>
  return {
    model: isModelId(record['model']) ? record['model'] : defaultSettings().model,
    pageAccess: record['pageAccess'] === true,
    // Settings saved before the option existed keep history search on.
    historyAccess: record['historyAccess'] !== false,
    ...(typeof record['encryptedKey'] === 'string' && { encryptedKey: record['encryptedKey'] }),
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

/** Throws unless `value` is null or something that looks like an API key. */
export function parseKey(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new TypeError('the key must be a string or null')
  const key = value.trim()
  if (!/^[\x21-\x7e]{8,512}$/.test(key)) throw new TypeError('that does not look like an API key')
  return key
}

export interface KeyCrypto {
  /** False when the OS offers no real encryption (e.g. Linux without a keyring). */
  available(): boolean
  encrypt(plain: string): string
  decrypt(encrypted: string): string
}

/** Settings plus the API key. The key is only ever returned to main-process callers. */
export class SettingsService {
  private sessionKey: string | null = null

  constructor(
    private readonly store: JsonStore<StoredSettings>,
    private readonly crypto: KeyCrypto,
    private readonly envKey: string | undefined,
  ) {}

  get(): AgentSettings {
    const { model, pageAccess, historyAccess, encryptedKey } = this.store.get()
    return {
      model,
      provider: providerOf(model),
      pageAccess,
      historyAccess,
      hasKey: this.apiKey() !== null,
      keyPersisted: encryptedKey !== undefined || this.sessionKey === null,
    }
  }

  update(update: SettingsUpdate): AgentSettings {
    this.store.set({ ...this.store.get(), ...update })
    return this.get()
  }

  setKey(key: string | null): AgentSettings {
    const { encryptedKey: _old, ...rest } = this.store.get()
    this.sessionKey = null
    if (key !== null && this.crypto.available()) {
      this.store.set({ ...rest, encryptedKey: this.crypto.encrypt(key) })
    } else {
      this.store.set(rest)
      this.sessionKey = key
    }
    return this.get()
  }

  apiKey(): string | null {
    if (this.sessionKey) return this.sessionKey
    const { encryptedKey } = this.store.get()
    if (encryptedKey && this.crypto.available()) {
      try {
        return this.crypto.decrypt(encryptedKey)
      } catch (error) {
        console.warn('Could not decrypt the stored API key', error)
      }
    }
    return this.envKey?.trim() || null
  }
}
