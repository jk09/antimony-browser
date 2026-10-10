import { describe, expect, it } from 'vitest'
import { groupSessions, SESSION_GAP_MS } from './sessions'

const MIN = 60_000
const row = (url: string, minute: number, title = url) => ({ url, title, at: minute * MIN })

describe('groupSessions', () => {
  it('splits at gaps over 30 minutes and orders by time', () => {
    const sessions = groupSessions([
      row('https://c.example/', 100),
      row('https://a.example/', 0),
      row('https://b.example/', 20),
      row('https://d.example/', 110),
    ])
    expect(sessions.map((s) => s.pages.map((p) => p.url))).toEqual([
      ['https://a.example/', 'https://b.example/'],
      ['https://c.example/', 'https://d.example/'],
    ])
    expect(sessions[0]).toMatchObject({ startedAt: 0, endedAt: 20 * MIN })
  })

  it('keeps visits exactly 30 minutes apart together', () => {
    expect(SESSION_GAP_MS).toBe(30 * MIN)
    expect(
      groupSessions([row('https://a.example/', 0), row('https://b.example/', 30)]),
    ).toHaveLength(1)
    expect(
      groupSessions([row('https://a.example/', 0), row('https://b.example/', 31)]),
    ).toHaveLength(2)
  })

  it('reuses the page of a repeat visit, ignoring the fragment, and fills an empty title', () => {
    const [session] = groupSessions([
      row('https://a.example/x', 0, ''),
      row('https://b.example/', 1),
      row('https://a.example/x#top', 2, 'Titled'),
    ])
    expect(session!.pages).toEqual([
      { url: 'https://a.example/x', title: 'Titled', firstAt: 0, lastAt: 2 * MIN },
      { url: 'https://b.example/', title: 'https://b.example/', firstAt: MIN, lastAt: MIN },
    ])
  })

  it('returns nothing for no rows', () => {
    expect(groupSessions([])).toEqual([])
  })
})
