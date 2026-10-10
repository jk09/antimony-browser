import { describe, expect, it } from 'vitest'
import { mostlyKnown, stackFromImport } from './imported'
import { rows } from './tree'

const page = (url: string, title: string, at: number) => ({ url, title, at })

describe('stackFromImport', () => {
  it('chains the pages in order, named as given, last used at the group’s last visit', () => {
    const stack = stackFromImport(
      's1',
      {
        name: 'Sourdough Baking!',
        lastAt: 9000,
        pages: [
          page('https://a.example/', 'Sourdough basics', 1000),
          page('https://b.example/', 'Flour types', 2000),
          page('https://c.example/', 'Baking times', 5000),
        ],
      },
      new Set(),
      777,
    )
    expect(rows(stack).map((row) => `${row.depth}:${row.title}`)).toEqual([
      '0:Sourdough basics',
      '1:Flour types',
      '2:Baking times',
    ])
    expect(stack).toMatchObject({
      name: 'sourdough-baking',
      lastUsedAt: 9000,
      imported: 777,
      activeId: 3,
    })
    expect(stack.nodes[2]!.lastVisitedAt).toBe(2000)
  })

  it('keeps names unique, and names an unnamed group like any stack (title, else host)', () => {
    const group = {
      name: '',
      lastAt: 2,
      pages: [page('https://www.news.example/a', '', 1), page('https://x.example/', '', 2)],
    }
    expect(stackFromImport('a', group, new Set(), 1).name).toBe('news-example')
    expect(stackFromImport('b', { ...group, name: 'news' }, new Set(['news']), 1).name).toBe(
      'news-2',
    )
    expect(
      stackFromImport(
        'c',
        { ...group, pages: [page('https://a.example/', 'A title', 1), group.pages[1]!] },
        new Set(),
        1,
      ).name,
    ).toBe('a-title')
  })

  it('keeps the newest 500 pages and skips an immediate repeat of the same page', () => {
    const pages = Array.from({ length: 600 }, (_, n) => page(`https://a.example/${n}`, `P${n}`, n))
    const stack = stackFromImport('s', { name: 'x', lastAt: 600, pages }, new Set(), 1)
    expect(Object.keys(stack.nodes)).toHaveLength(500)
    expect(stack.nodes[stack.rootId!]!.title).toBe('P100')

    const repeat = stackFromImport(
      's',
      {
        name: 'x',
        lastAt: 3,
        pages: [page('https://a.example/', 'A', 1), page('https://a.example/#x', '', 2)],
      },
      new Set(),
      1,
    )
    expect(Object.keys(repeat.nodes)).toHaveLength(1)
  })
})

describe('mostlyKnown', () => {
  const group = {
    name: 'x',
    lastAt: 1,
    pages: ['a', 'b', 'c', 'd', 'e'].map((n) => page(`https://${n}.example/#f`, n, 1)),
  }
  it('is true from 80 % of the pages (ignoring fragments)', () => {
    const known = (n: number) =>
      new Set(['a', 'b', 'c', 'd', 'e'].slice(0, n).map((x) => `https://${x}.example/`))
    expect(mostlyKnown(group, known(4))).toBe(true)
    expect(mostlyKnown(group, known(3))).toBe(false)
    expect(mostlyKnown(group, new Set())).toBe(false)
  })
})
