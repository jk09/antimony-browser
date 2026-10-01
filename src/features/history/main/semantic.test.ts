import { describe, expect, it } from 'vitest'
import type { Candidate } from './db'
import { parseRanking, rankingPrompt, SEMANTIC_LIMIT } from './semantic'

const candidate = (id: number, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  url: `https://example.com/${id}`,
  title: `Page ${id}`,
  lastVisitAt: Date.UTC(2026, 8, 30),
  description: null,
  summary: null,
  visualDescription: null,
  note: null,
  ...overrides,
})

describe('semantic search', () => {
  it('describes candidates as untrusted JSON lines, with only the fields they have', () => {
    const prompt = rankingPrompt('blue pricing table', [
      candidate(1, {
        summary: 'Vector DB pricing',
        visualDescription: 'A blue table',
        note: 'cheap',
      }),
      candidate(2),
    ])
    const lines = prompt.split('\n')
    expect(lines[0]).toBe('<untrusted_history>')
    expect(JSON.parse(lines[1]!)).toEqual({
      id: 1,
      title: 'Page 1',
      url: 'https://example.com/1',
      visited: '2026-09-30',
      summary: 'Vector DB pricing',
      looks: 'A blue table',
      note: 'cheap',
    })
    expect(Object.keys(JSON.parse(lines[2]!))).toEqual(['id', 'title', 'url', 'visited'])
    expect(prompt.endsWith('</untrusted_history>\n\nRequest: blue pricing table')).toBe(true)
  })

  it('keeps known ids in the model order, without duplicates', () => {
    const known = new Set([1, 2, 3])
    expect(parseRanking('[3, 1, 3, 99, "2"]', known)).toEqual([3, 1, 2])
    expect(parseRanking('Here you go: [2]\nThanks', known)).toEqual([2])
    expect(parseRanking('[]', known)).toEqual([])
  })

  it('returns null for answers without a list', () => {
    const known = new Set([1])
    expect(parseRanking('No idea', known)).toBeNull()
    expect(parseRanking('[1, oops]', known)).toBeNull()
  })

  it('caps the number of results', () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1)
    expect(parseRanking(JSON.stringify(ids), new Set(ids))).toHaveLength(SEMANTIC_LIMIT)
  })
})
