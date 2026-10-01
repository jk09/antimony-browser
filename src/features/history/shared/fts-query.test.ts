import { describe, expect, it } from 'vitest'
import { ftsQuery, terms } from './fts-query'

describe('ftsQuery', () => {
  it('makes every word a quoted prefix term', () => {
    expect(ftsQuery('SQLite WAL')).toBe('"sqlite"* "wal"*')
    expect(ftsQuery('SQLite WAL', 'or')).toBe('"sqlite"* OR "wal"*')
  })

  it('neutralises FTS syntax', () => {
    expect(ftsQuery('title:secret NEAR(a b) "x" ^y -z *')).toBe(
      '"title"* "secret"* "near"* "a"* "b"* "x"* "y"* "z"*',
    )
    expect(ftsQuery('"); DROP TABLE pages; --')).toBe('"drop"* "table"* "pages"*')
  })

  it('keeps letters of any script and de-duplicates', () => {
    expect(terms('Čaj čaj 東京 café')).toEqual(['čaj', '東京', 'café'])
  })

  it('returns null without words', () => {
    expect(ftsQuery('  -- ** ')).toBeNull()
    expect(ftsQuery('')).toBeNull()
  })

  it('caps the number of terms', () => {
    const many = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')
    expect(terms(many)).toHaveLength(16)
  })
})
