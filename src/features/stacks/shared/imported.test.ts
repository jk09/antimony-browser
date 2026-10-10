import { describe, expect, it } from 'vitest'
import { rows } from './tree'
import { stackFromSession } from './imported'

const page = (url: string, title: string, at: number) => ({ url, title, at })

describe('stackFromSession', () => {
  it('chains the pages in visit order, named after the first, last used when the session ended', () => {
    const stack = stackFromSession(
      's1',
      {
        startedAt: 1000,
        endedAt: 5000,
        pages: [
          page('https://a.example/', 'Sourdough basics', 1000),
          page('https://b.example/', 'Flour types', 2000),
          page('https://c.example/', 'Baking times', 5000),
        ],
      },
      new Set(),
    )
    expect(rows(stack).map((row) => `${row.depth}:${row.title}`)).toEqual([
      '0:Sourdough basics',
      '1:Flour types',
      '2:Baking times',
    ])
    expect(stack).toMatchObject({
      name: 'sourdough-basics',
      lastUsedAt: 5000,
      imported: 1000,
      activeId: 3,
    })
    expect(stack.nodes[2]!.lastVisitedAt).toBe(2000)
  })

  it('names by host without a title and keeps names unique', () => {
    const session = {
      startedAt: 1,
      endedAt: 2,
      pages: [page('https://www.news.example/a', '', 1), page('https://x.example/', '', 2)],
    }
    expect(stackFromSession('a', session, new Set()).name).toBe('news-example')
    expect(stackFromSession('b', session, new Set(['news-example'])).name).toBe('news-example-2')
  })

  it('keeps the newest 500 pages and skips an immediate repeat of the same page', () => {
    const pages = Array.from({ length: 600 }, (_, n) => page(`https://a.example/${n}`, `P${n}`, n))
    const stack = stackFromSession('s', { startedAt: 0, endedAt: 600, pages }, new Set())
    expect(Object.keys(stack.nodes)).toHaveLength(500)
    expect(stack.nodes[stack.rootId!]!.title).toBe('P100')

    const repeat = stackFromSession(
      's',
      {
        startedAt: 0,
        endedAt: 3,
        pages: [page('https://a.example/', 'A', 1), page('https://a.example/#x', '', 2)],
      },
      new Set(),
    )
    expect(Object.keys(repeat.nodes)).toHaveLength(1)
  })
})
