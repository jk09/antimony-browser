import { describe, expect, it } from 'vitest'
import { matchRanges, searchPages, urlPrefixLength } from './search'

const pages = [
  { title: 'United States Air Force - Wikipedia', url: 'https://en.wikipedia.org/wiki/USAF' },
  { title: 'Lifting body', url: 'https://en.wikipedia.org/wiki/Lifting_body' },
  { title: '', url: 'https://example.com/air' },
]

describe('searchPages', () => {
  it('finds pages by any part of the title or URL, every word required, in order', () => {
    expect(searchPages(pages, 'air')).toEqual([0, 2])
    expect(searchPages(pages, 'FORCE wiki')).toEqual([0])
    expect(searchPages(pages, 'wiki body')).toEqual([1])
    expect(searchPages(pages, 'example')).toEqual([2])
    expect(searchPages(pages, 'zebra')).toEqual([])
  })

  it('skips the scheme and www. of URLs', () => {
    expect(searchPages(pages, 'https')).toEqual([])
    expect(searchPages(pages, 'en.wiki')).toEqual([0, 1])
    expect(urlPrefixLength('https://www.example.com/')).toBe('https://www.'.length)
    expect(urlPrefixLength('about:blank')).toBe('about:'.length)
  })

  it('matches nothing for an empty query', () => {
    expect(searchPages(pages, '  ')).toEqual([])
  })
})

describe('matchRanges', () => {
  it('returns sorted, merged ranges of every word', () => {
    expect(matchRanges('Air Force air', 'air')).toEqual([
      [0, 3],
      [10, 13],
    ])
    expect(matchRanges('Lifting body', 'body lift ifti')).toEqual([
      [0, 5],
      [8, 12],
    ])
    expect(matchRanges('Lifting', '')).toEqual([])
  })
})
