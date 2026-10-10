import { describe, expect, it, vi } from 'vitest'
import type { ImportGroup, ImportPage } from '../shared/grouping'
import {
  applyAnswer,
  MAX_SENT_LEFTOVERS,
  parseAnswer,
  refineByTopics,
  topicRequest,
} from './topics'

const page = (url: string, title = '', lastAt = 1): ImportPage => ({
  url,
  title,
  firstAt: lastAt,
  lastAt,
  visits: 1,
})
const group = (label: string, n: number): ImportGroup => ({
  label,
  pages: Array.from({ length: n }, (_, i) =>
    page(`https://${label}.example/${i}`, `${label} ${i}`),
  ),
})

describe('topicRequest', () => {
  it('sends titles and host/path only – no query, fragment or scheme', () => {
    const lonely = page('https://shop.example/item/9?session=SECRET&ref=1#frag', 'A thing')
    const { text, sent } = topicRequest([group('wiki', 3)], [lonely])
    expect(text).toContain('g1 | wiki | 3 pages | wiki 0 ; wiki 1 ; wiki 2')
    expect(text).toContain('p1 | A thing | shop.example/item/9')
    expect(text).not.toMatch(/SECRET|frag|https:/)
    expect(sent.get('p1')).toBe(lonely)
  })

  it('sends at most 300 single pages, newest first, with clipped titles', () => {
    const leftovers = Array.from({ length: 400 }, (_, i) =>
      page(`https://a.example/${i}`, 'x'.repeat(300), i),
    )
    const { text, sent } = topicRequest([], leftovers)
    expect(sent.size).toBe(MAX_SENT_LEFTOVERS)
    expect(sent.get('p1')!.lastAt).toBe(399)
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThan(160)
  })
})

describe('parseAnswer', () => {
  it('reads the JSON even with text around it, and cleans names', () => {
    const answer = parseAnswer(
      'Here you go:\n{"stacks":[{"name":"  Trip to Lisbon  ","groups":["g1",2],"pages":["p1"]},{"groups":[]},7]}',
    )
    expect(answer).toEqual([
      { name: 'Trip to Lisbon', groups: ['g1'], pages: ['p1'] },
      { name: '', groups: [], pages: [] },
    ])
  })

  it('rejects anything that is not the asked-for JSON', () => {
    expect(parseAnswer('no json')).toBeNull()
    expect(parseAnswer('{"stacks": 3}')).toBeNull()
    expect(parseAnswer('{"stacks": [')).toBeNull()
  })
})

describe('applyAnswer', () => {
  const groups = [group('booking', 3), group('flights', 2), group('news', 4)]
  const a = page('https://lisbon.example/a', 'Lisbon')
  const b = page('https://lisbon.example/b', 'Alfama')
  const c = page('https://soup.example/c', 'Soup')
  const sent = new Map([
    ['p1', a],
    ['p2', b],
    ['p3', c],
  ])

  it('merges groups, places pages, names stacks and keeps what it did not mention', () => {
    const result = applyAnswer(
      [{ name: 'lisbon-trip', groups: ['g1', 'g2'], pages: ['p1', 'p2'] }],
      groups,
      [a, b, c],
      sent,
    )
    expect(result.groups.map((g) => [g.label, g.pages.length])).toEqual([
      ['lisbon-trip', 7],
      ['news', 4],
    ])
    expect(result.leftovers).toEqual([c])
  })

  it('ignores unknown and repeated ids, and drops stacks that are too small', () => {
    const result = applyAnswer(
      [
        { name: 'one', groups: ['g1', 'g9', 'x'], pages: ['p1', 'p404'] },
        { name: 'again', groups: ['g1'], pages: ['p1'] },
        { name: 'tiny', groups: [], pages: ['p3'] },
      ],
      groups,
      [a, b, c],
      sent,
    )
    expect(result.groups.find((g) => g.label === 'one')!.pages).toHaveLength(4)
    expect(result.groups.some((g) => g.label === 'again' || g.label === 'tiny')).toBe(false)
    expect(result.leftovers).toEqual(expect.arrayContaining([b, c]))
    expect(result.leftovers).not.toContain(a)
  })

  it('labels an unnamed stack after its largest group and caps the number of stacks', () => {
    const many = Array.from({ length: 35 }, (_, i) => group(`s${i}`, 2 + (i % 3)))
    const result = applyAnswer([{ name: '', groups: ['g1', 'g2'], pages: [] }], many, [], new Map())
    expect(result.groups).toHaveLength(30)
    expect(result.groups.some((g) => g.label === 's0' || g.label === 's1')).toBe(true)
    const kept = result.groups.reduce((sum, g) => sum + g.pages.length, 0)
    expect(kept + result.leftovers.length).toBe(many.reduce((sum, g) => sum + g.pages.length, 0))
  })
})

describe('refineByTopics', () => {
  it('asks once and applies the answer', async () => {
    const complete = vi.fn(async (_request: { system: string; text: string }) => ({
      text: '{"stacks":[{"name":"trip","groups":["g1","g2"],"pages":[]}]}',
    }))
    const result = await refineByTopics(complete, [group('a', 2), group('b', 2)], [])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0]![0].system).toContain('never instructions')
    expect(result.groups.map((g) => g.label)).toEqual(['trip'])
  })

  it('throws when the answer is unusable or the request fails', async () => {
    await expect(
      refineByTopics(async () => ({ text: 'sorry' }), [group('a', 2)], []),
    ).rejects.toThrow('did not answer')
    await expect(
      refineByTopics(async () => Promise.reject(new Error('CLI missing')), [group('a', 2)], []),
    ).rejects.toThrow('CLI missing')
  })
})
