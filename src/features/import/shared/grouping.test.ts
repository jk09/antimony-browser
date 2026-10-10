import { describe, expect, it } from 'vitest'
import {
  chainOrder,
  domainLabel,
  groupByAddress,
  pagesOf,
  placeLeftovers,
  registrableDomain,
  SPLIT_ABOVE,
  type ImportPage,
} from './grouping'

const page = (url: string, title = '', at = 1000): ImportPage => ({
  url,
  title,
  firstAt: at,
  lastAt: at,
  visits: 1,
})
const many = (host: string, n: number, path = (i: number) => `/p${i}`, at = 1000) =>
  Array.from({ length: n }, (_, i) => page(`https://${host}${path(i)}`, `Page ${i}`, at + i))

describe('registrableDomain', () => {
  it('reduces hosts to their registrable domain', () => {
    expect(registrableDomain('en.wikipedia.org')).toBe('wikipedia.org')
    expect(registrableDomain('www.news.bbc.co.uk')).toBe('bbc.co.uk')
    expect(registrableDomain('localhost')).toBe('localhost')
    expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1')
    expect(domainLabel('bbc.co.uk')).toBe('bbc')
    expect(domainLabel('127.0.0.1')).toBe('127.0.0.1')
  })
})

describe('pagesOf', () => {
  it('merges visits to one address, ignoring the fragment, with first title and visit range', () => {
    const [only, ...rest] = pagesOf([
      { url: 'https://a.example/x', title: '', at: 5 },
      { url: 'https://a.example/x#top', title: 'X', at: 2 },
      { url: 'https://a.example/x', title: 'Later', at: 9 },
    ])
    expect(rest).toEqual([])
    expect(only).toEqual({
      url: 'https://a.example/x',
      title: 'X',
      firstAt: 2,
      lastAt: 9,
      visits: 3,
    })
  })
})

describe('groupByAddress', () => {
  it('groups subdomains of one site, and leaves single pages as leftovers', () => {
    const { groups, leftovers } = groupByAddress([
      page('https://en.wikipedia.org/wiki/A'),
      page('https://de.wikipedia.org/wiki/B'),
      page('https://github.com/x/y'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ label: 'wikipedia' })
    expect(groups[0]!.pages).toHaveLength(2)
    expect(leftovers.map((p) => p.url)).toEqual(['https://github.com/x/y'])
  })

  it('splits a big site by the first path part, keeping small parts in the site group', () => {
    const pages = [
      ...many('github.com', 30, (i) => `/torvalds/repo${i}`),
      ...many('github.com', 25, (i) => `/rust-lang/r${i}`),
      ...many('github.com', 7, (i) => `/lone${i}/x`),
      ...many('github.com', SPLIT_ABOVE - 61 + 5, (i) => `/pair${i % 2}/x${i}`),
    ]
    expect(pages.length).toBeGreaterThan(SPLIT_ABOVE)
    const { groups } = groupByAddress(pages)
    const labels = groups.map((g) => g.label)
    expect(labels).toContain('github-torvalds')
    expect(labels).toContain('github-rust-lang')
    // The 7 one-off parts and the 4 pages of two thin parts stay with the site.
    expect(groups.find((g) => g.label === 'github')!.pages).toHaveLength(11)
  })

  it('does not split a site of 60 pages or fewer', () => {
    const { groups } = groupByAddress(many('wiki.example', SPLIT_ABOVE, (i) => `/s${i % 3}/p${i}`))
    expect(groups.map((g) => g.label)).toEqual(['wiki'])
  })

  it('keeps the largest groups up to the limit and demotes the rest to leftovers', () => {
    const pages = [
      ...many('big.example', 5),
      ...many('mid.example', 3),
      ...many('small.example', 2),
    ]
    const { groups, leftovers } = groupByAddress(pages, 2)
    expect(groups.map((g) => g.label)).toEqual(['big', 'mid'])
    expect(leftovers.map((p) => p.url)).toEqual([
      'https://small.example/p0',
      'https://small.example/p1',
    ])
  })

  it('treats unparseable addresses as leftovers', () => {
    expect(groupByAddress([page('not a url')]).leftovers).toHaveLength(1)
  })
})

describe('placeLeftovers', () => {
  const trip = [
    page('https://booking.example/hotel/lisbon-alfama', 'Hotel Alfama Lisbon', 1),
    page('https://booking.example/hotel/lisbon-baixa', 'Hotel Baixa Lisbon', 2),
  ]
  const other = [
    page('https://news.example/a', 'Daily headlines', 3),
    page('https://news.example/b', 'More headlines', 4),
  ]
  const filler = many('filler.example', 12, (i) => `/x${i}`).map((p, i) => ({
    ...p,
    title: `Gadget ${i}`,
  }))

  it('adds a page to the group sharing at least two distinctive words, others stay out', () => {
    const groups = [
      { label: 'booking', pages: [...trip] },
      { label: 'news', pages: [...other] },
    ]
    const near = page('https://lisbon-guide.example/alfama-walks', 'Alfama walks in Lisbon')
    const far = page('https://cooking.example/soup', 'Pumpkin soup')
    const unplaced = placeLeftovers(groups, [near, far], [...trip, ...other, ...filler, near, far])
    expect(unplaced).toEqual([far])
    expect(groups[0]!.pages).toContain(near)
    expect(groups[1]!.pages).not.toContain(near)
  })

  it('needs groups and leftovers', () => {
    const lone = page('https://a.example/', 'Alone')
    expect(placeLeftovers([], [lone], [lone])).toEqual([lone])
  })
})

describe('chainOrder', () => {
  it('orders by first visit and keeps the newest 500', () => {
    const pages = Array.from({ length: 520 }, (_, i) => page(`https://a.example/${i}`, '', i))
    const chain = chainOrder(pages)
    expect(chain).toHaveLength(500)
    expect(chain[0]!.url).toBe('https://a.example/20')
    expect(chain.at(-1)!.url).toBe('https://a.example/519')
  })
})
