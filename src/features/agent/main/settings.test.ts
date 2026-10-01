import { describe, expect, it } from 'vitest'
import type { JsonStore } from '../../../app/main/json-store'
import {
  defaultSettings,
  parseKey,
  parseSettings,
  parseUpdate,
  SettingsService,
  type KeyCrypto,
  type StoredSettings,
} from './settings'

function memoryStore(
  initial = defaultSettings(),
): JsonStore<StoredSettings> & { value: StoredSettings } {
  const store = {
    value: initial,
    get: () => store.value,
    set: (value: StoredSettings) => {
      store.value = value
    },
    flush: () => {},
  }
  return store
}

const crypto = (available: boolean): KeyCrypto => ({
  available: () => available,
  encrypt: (plain) => `enc(${plain})`,
  decrypt: (encrypted) => encrypted.replace(/^enc\((.*)\)$/, '$1'),
})

describe('SettingsService', () => {
  it('starts with Sonnet 5.5 and page access off', () => {
    const settings = new SettingsService(memoryStore(), crypto(true), undefined)
    expect(settings.get()).toEqual({
      model: 'claude-sonnet-5-5',
      provider: 'anthropic',
      pageAccess: false,
      hasKey: false,
      keyPersisted: true,
    })
  })

  it('stores the key encrypted and never in plain text', () => {
    const store = memoryStore()
    const settings = new SettingsService(store, crypto(true), undefined)
    settings.setKey('sk-ant-secret-1')
    expect(store.value.encryptedKey).toBe('enc(sk-ant-secret-1)')
    expect(JSON.stringify(settings.get())).not.toContain('secret')
    expect(settings.apiKey()).toBe('sk-ant-secret-1')
    settings.setKey(null)
    expect(store.value.encryptedKey).toBeUndefined()
    expect(settings.apiKey()).toBeNull()
  })

  it('keeps the key in memory only when encryption is unavailable', () => {
    const store = memoryStore()
    const settings = new SettingsService(store, crypto(false), undefined)
    settings.setKey('sk-ant-secret-1')
    expect(store.value.encryptedKey).toBeUndefined()
    expect(settings.apiKey()).toBe('sk-ant-secret-1')
    expect(settings.get()).toMatchObject({ hasKey: true, keyPersisted: false })
  })

  it('falls back to ANTHROPIC_API_KEY', () => {
    const settings = new SettingsService(memoryStore(), crypto(true), 'sk-from-env')
    expect(settings.apiKey()).toBe('sk-from-env')
    settings.setKey('sk-ant-stored-1')
    expect(settings.apiKey()).toBe('sk-ant-stored-1')
  })
})

describe('parsing', () => {
  it('validates settings updates from the UI', () => {
    expect(parseUpdate({ model: 'claude-opus-5-5', pageAccess: true })).toEqual({
      model: 'claude-opus-5-5',
      pageAccess: true,
    })
    expect(() => parseUpdate({ model: 'gpt-4' })).toThrow()
    expect(() => parseUpdate({ pageAccess: 'yes' })).toThrow()
    expect(() => parseUpdate({ encryptedKey: 'x' })).toThrow()
    expect(() => parseUpdate(null)).toThrow()
  })

  it('accepts well-formed Ollama model ids, installed or not', () => {
    for (const model of ['ollama:qwen3:8b', 'ollama:library/llama3.2:latest', 'ollama:x']) {
      expect(parseUpdate({ model })).toEqual({ model })
    }
    for (const model of ['ollama:', 'ollama: qwen', 'ollama:-x', 'ollama:a b', 'qwen3:8b']) {
      expect(() => parseUpdate({ model }), model).toThrow()
    }
    expect(() => parseUpdate({ model: `ollama:${'x'.repeat(201)}` })).toThrow()
  })

  it('derives the provider from the model', () => {
    const store = memoryStore({ model: 'ollama:qwen3:8b', pageAccess: false })
    const settings = new SettingsService(store, crypto(true), undefined)
    expect(settings.get()).toMatchObject({ model: 'ollama:qwen3:8b', provider: 'ollama' })
    expect(parseSettings({ model: 'ollama:qwen3:8b' }).model).toBe('ollama:qwen3:8b')
    expect(settings.update({ model: 'claude-opus-5-5' }).provider).toBe('anthropic')
  })

  it('validates keys', () => {
    expect(parseKey(' sk-ant-123456 ')).toBe('sk-ant-123456')
    expect(parseKey(null)).toBeNull()
    for (const bad of [42, '', 'short', 'has space inside', 'x'.repeat(600)]) {
      expect(() => parseKey(bad), String(bad)).toThrow()
    }
  })

  it('repairs stored settings', () => {
    expect(parseSettings({ model: 'nope', pageAccess: 'yes' })).toEqual(defaultSettings())
    expect(() => parseSettings('x')).toThrow()
  })
})
