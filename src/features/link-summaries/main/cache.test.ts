import { describe, expect, it } from 'vitest'
import { SummaryCache } from './cache'

describe('SummaryCache', () => {
  it('drops the least recently used entries beyond its size and remembers misses', () => {
    const cache = new SummaryCache(2)
    cache.set('a', { title: 'A', summary: 'a' })
    cache.set('b', null)
    expect(cache.get('a')).toEqual({ title: 'A', summary: 'a' })
    cache.set('c', { title: 'C', summary: 'c' })
    expect(cache.has('b')).toBe(false)
    expect(cache.has('a')).toBe(true)
    expect(cache.get('c')).toEqual({ title: 'C', summary: 'c' })
    expect(cache.get('x')).toBeUndefined()
    cache.clear()
    expect(cache.size).toBe(0)
  })
})
