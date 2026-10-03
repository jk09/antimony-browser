import { describe, expect, it } from 'vitest'
import { findMatch } from './typeahead'

const labels = ['Home', 'Hotel deals', 'News', 'Hockey', 'docs']

describe('findMatch', () => {
  it('finds the first label with the prefix, ignoring case, wrapping around', () => {
    expect(findMatch(labels, 0, 'n')).toBe(2)
    expect(findMatch(labels, 3, 'DO')).toBe(4)
    expect(findMatch(labels, 4, 'ho')).toBe(0)
  })

  it('steps through labels with one repeated letter, but a longer prefix may stay put', () => {
    expect(findMatch(labels, 0, 'h')).toBe(1)
    expect(findMatch(labels, 1, 'hh')).toBe(3)
    expect(findMatch(labels, 3, 'hh')).toBe(0)
    expect(findMatch(labels, 1, 'ho')).toBe(1)
    expect(findMatch(labels, 1, 'hot')).toBe(1)
  })

  it('returns -1 without a match or a prefix', () => {
    expect(findMatch(labels, 0, 'zz')).toBe(-1)
    expect(findMatch(labels, 0, '')).toBe(-1)
    expect(findMatch([], 0, 'a')).toBe(-1)
  })
})
