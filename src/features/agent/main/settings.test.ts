import { describe, expect, it } from 'vitest'
import { defaultSettings, parseSettings, parseUpdate } from './settings'

describe('settings', () => {
  it('starts with Sonnet 5.5, page access off and history access on', () => {
    expect(defaultSettings()).toEqual({
      model: 'claude-sonnet-5-5',
      pageAccess: false,
      historyAccess: true,
    })
  })

  it('validates settings updates from the UI', () => {
    expect(parseUpdate({ model: 'claude-opus-5-5', pageAccess: true })).toEqual({
      model: 'claude-opus-5-5',
      pageAccess: true,
    })
    expect(() => parseUpdate({ model: 'gpt-4' })).toThrow()
    expect(() => parseUpdate({ pageAccess: 'yes' })).toThrow()
    expect(parseUpdate({ historyAccess: false })).toEqual({ historyAccess: false })
    expect(() => parseUpdate({ historyAccess: 'off' })).toThrow()
    expect(() => parseUpdate({ encryptedKey: 'x' })).toThrow()
    expect(() => parseUpdate(null)).toThrow()
  })

  it('accepts only the Claude model ids, no longer cli: or ollama: ones', () => {
    for (const model of ['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      expect(parseUpdate({ model })).toEqual({ model })
    }
    for (const model of ['cli:claude-opus-5-5', 'ollama:qwen3:8b', 'opus', '']) {
      expect(() => parseUpdate({ model }), model).toThrow()
    }
  })

  it('migrates settings stored with several backends: cli: ids, Ollama ids and the API key', () => {
    expect(parseSettings({ model: 'cli:claude-opus-5-5' }).model).toBe('claude-opus-5-5')
    expect(parseSettings({ model: 'cli:claude-haiku-4-5' }).model).toBe('claude-haiku-4-5')
    expect(parseSettings({ model: 'ollama:qwen3:8b' }).model).toBe('claude-sonnet-5-5')
    expect(
      parseSettings({ model: 'claude-opus-5-5', pageAccess: true, encryptedKey: 'abc' }),
    ).toEqual({ model: 'claude-opus-5-5', pageAccess: true, historyAccess: true })
  })

  it('repairs stored settings', () => {
    expect(parseSettings({ model: 'nope', pageAccess: 'yes' })).toEqual(defaultSettings())
    // Settings saved before history access existed keep it on; only an explicit false turns it off.
    expect(parseSettings({ historyAccess: 'no' }).historyAccess).toBe(true)
    expect(parseSettings({ historyAccess: false }).historyAccess).toBe(false)
    expect(() => parseSettings('x')).toThrow()
  })
})
