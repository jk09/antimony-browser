import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createJsonStore } from './json-store'

const numbers = {
  parse: (raw: unknown) => {
    if (!Array.isArray(raw)) throw new TypeError('not an array')
    return raw as number[]
  },
  fallback: () => [] as number[],
}

describe('createJsonStore', () => {
  it('starts from the fallback and writes after a delay, or on flush', () => {
    vi.useFakeTimers()
    try {
      const file = join(mkdtempSync(join(tmpdir(), 'store-')), 'sub', 'n.json')
      const store = createJsonStore(file, numbers)
      expect(store.get()).toEqual([])
      store.set([1])
      store.set([1, 2])
      expect(existsSync(file)).toBe(false)
      vi.advanceTimersByTime(500)
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([1, 2])
      store.set([3])
      store.flush()
      expect(createJsonStore(file, numbers).get()).toEqual([3])
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves an invalid file aside instead of overwriting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-'))
    const file = join(dir, 'n.json')
    writeFileSync(file, '{"not": "numbers"}')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createJsonStore(file, numbers).get()).toEqual([])
    expect(readdirSync(dir).some((name) => /^n\.corrupt-\d+\.json$/.test(name))).toBe(true)
  })
})
