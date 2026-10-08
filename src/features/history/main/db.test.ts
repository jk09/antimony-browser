import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HIGH_DWELL_MS, SNIPPET_END, SNIPPET_START } from '../ipc'
import { ftsQuery } from '../shared/fts-query'
import type { PageMeta } from '../shared/page-meta'
import { HistoryDb } from './db'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 1)

const meta = (overrides: Partial<PageMeta> = {}): PageMeta => ({
  title: '',
  description: null,
  siteName: null,
  ogType: null,
  imageUrl: null,
  keywords: null,
  author: null,
  publishedAt: null,
  lang: 'en',
  contentType: 'text/html',
  contentLanguage: null,
  lastModified: null,
  canonicalLink: null,
  text: '',
  sensitive: false,
  ...overrides,
})

let db: HistoryDb

beforeEach(() => {
  db = new HistoryDb(':memory:')
})
afterEach(() => db.close())

function visit(url: string, at = NOW, transition: 'link' | 'typed' = 'link') {
  return db.startVisit({ url, title: '', transition, at, referrerPageId: null })
}

describe('HistoryDb', () => {
  it('keeps one page per canonical URL and one row per visit', () => {
    const first = visit('https://example.com/a', NOW - DAY, 'typed')
    const second = visit('https://example.com/a', NOW)
    expect(second.pageId).toBe(first.pageId)
    expect(second.visitId).not.toBe(first.visitId)
    const [page] = db.raw(
      'SELECT visit_count, typed_count, first_visit_at, last_visit_at FROM pages WHERE id = ?',
      first.pageId,
    )
    expect(page).toEqual({
      visit_count: 2,
      typed_count: 1,
      first_visit_at: NOW - DAY,
      last_visit_at: NOW,
    })
  })

  it('adds dwell to the visit and the page, and tracks the longest visit', () => {
    const a = visit('https://example.com/a')
    db.addDwell(a.visitId, 5000)
    db.addDwell(a.visitId, 7000)
    const b = visit('https://example.com/a')
    db.addDwell(b.visitId, 3000)
    expect(db.raw('SELECT dwell_ms, max_dwell_ms FROM pages')).toEqual([
      { dwell_ms: 15000, max_dwell_ms: 12000 },
    ])
    expect(db.raw('SELECT dwell_ms FROM visits ORDER BY id')).toEqual([
      { dwell_ms: 12000 },
      { dwell_ms: 3000 },
    ])
  })

  it('accepts a screenshot and a summary only after a high-dwell visit', () => {
    const { pageId, visitId } = visit('https://example.com/a')
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff])
    expect(() => db.setScreenshot(pageId, jpeg, NOW)).toThrow(/CHECK/)
    expect(() =>
      db.setSummary(
        pageId,
        { summary: 'x', visualDescription: null, model: 'm', textHash: null },
        NOW,
      ),
    ).toThrow(/CHECK/)
    expect(db.page(pageId)).toMatchObject({ hasScreenshot: false, summary: null })

    db.addDwell(visitId, HIGH_DWELL_MS)
    db.setScreenshot(pageId, jpeg, NOW)
    db.setSummary(
      pageId,
      { summary: 'About cats', visualDescription: 'A grey cat', model: 'm', textHash: null },
      NOW,
    )
    expect(db.page(pageId)).toMatchObject({ hasScreenshot: true, summary: 'About cats' })
    expect(Array.from(db.screenshot(pageId)!)).toEqual([0xff, 0xd8, 0xff])
    expect(db.needsScreenshot(pageId, NOW + DAY)).toBe(false)
    expect(db.needsScreenshot(pageId, NOW + 8 * DAY)).toBe(true)
  })

  it('keeps no text, screenshot or summary for sensitive pages', () => {
    const { pageId, visitId } = visit('https://bank.example/login')
    db.addDwell(visitId, HIGH_DWELL_MS)
    db.setMeta(pageId, meta({ text: 'Balance 1000', title: 'Log in' }), NOW)
    db.setScreenshot(pageId, new Uint8Array([1]), NOW)
    db.setMeta(pageId, meta({ text: '', title: 'Log in', sensitive: true }), NOW)
    expect(db.raw('SELECT text, screenshot, title FROM pages')).toEqual([
      { text: null, screenshot: null, title: 'Log in' },
    ])
    expect(db.needsScreenshot(pageId, NOW)).toBe(false)
    db.setScreenshot(pageId, new Uint8Array([1]), NOW)
    expect(db.screenshot(pageId)).toBeNull()
  })

  describe('suggest', () => {
    it('matches URL and domain prefixes, ignoring scheme, www and case', () => {
      visit('https://www.example.com/docs/start')
      visit('https://en.wikipedia.org/wiki/SQLite')
      visit('https://other.org/example.com')
      const urls = (typed: string) => db.suggest(typed, 8, NOW).map((page) => page.url)
      expect(urls('exa')).toEqual(['https://www.example.com/docs/start'])
      expect(urls('https://www.Example.com/Docs')).toEqual(['https://www.example.com/docs/start'])
      expect(urls('wikipedia')).toEqual(['https://en.wikipedia.org/wiki/SQLite'])
      expect(urls('en.wiki')).toEqual(['https://en.wikipedia.org/wiki/SQLite'])
      expect(urls('docs')).toEqual([])
      expect(urls('')).toEqual([])
    })

    it('ranks by frecency: typed visits count more, old visits less', () => {
      visit('https://example.com/old', NOW - 60 * DAY)
      visit('https://example.com/old', NOW - 60 * DAY)
      visit('https://example.com/old', NOW - 60 * DAY)
      visit('https://example.com/linked', NOW)
      visit('https://example.com/typed', NOW, 'typed')
      expect(db.suggest('example.com/', 8, NOW).map((page) => page.url)).toEqual([
        'https://example.com/typed',
        'https://example.com/linked',
        'https://example.com/old',
      ])
    })

    it('uses the bare and domain indexes, not a table scan', () => {
      const plan = db
        .explain(
          `SELECT url FROM pages WHERE (bare >= ?1 AND bare < ?2) OR (domain >= ?1 AND domain < ?2)`,
          'exa',
          'exa\u{10FFFF}',
        )
        .join('\n')
      expect(plan).toMatch(/pages_bare/)
      expect(plan).toMatch(/pages_domain/)
      expect(plan).not.toMatch(/SCAN pages(?! USING)/)
    })
  })

  describe('full-text search', () => {
    beforeEach(() => {
      const a = visit('https://example.com/wal', NOW - DAY)
      db.setMeta(
        a.pageId,
        meta({
          title: 'Write-ahead logging',
          text: 'SQLite uses a write-ahead log so readers do not block writers.',
        }),
        NOW,
      )
      const b = visit('https://example.com/cats', NOW)
      db.setMeta(b.pageId, meta({ title: 'Cats', description: 'All about cats' }), NOW)
      db.setNote(b.pageId, 'Ask Ana about the café recommendation', NOW)
    })

    const titles = (query: string, bookmarked = false) =>
      db.search(ftsQuery(query), { bookmarked, limit: 50 }).map((page) => page.title)

    it('finds pages by title, text and note, with prefix terms and diacritics folded', () => {
      expect(titles('readers block')).toEqual(['Write-ahead logging'])
      expect(titles('writ')).toEqual(['Write-ahead logging'])
      expect(titles('cafe')).toEqual(['Cats'])
      expect(titles('cats')).toEqual(['Cats'])
      expect(titles('dogs')).toEqual([])
    })

    it('returns a snippet with the matched words marked', () => {
      const [page] = db.search(ftsQuery('readers'), { bookmarked: false, limit: 5 })
      expect(page!.snippet).toContain(`${SNIPPET_START}readers${SNIPPET_END}`)
    })

    it('filters bookmarks and lists recent pages without a query', () => {
      expect(titles('example', true)).toEqual(['Cats'])
      expect(db.search(null, { bookmarked: false, limit: 50 }).map((p) => p.title)).toEqual([
        'Cats',
        'Write-ahead logging',
      ])
      expect(db.search(null, { bookmarked: true, limit: 50 }).map((p) => p.title)).toEqual(['Cats'])
    })

    it('keeps the index in sync on update and delete', () => {
      const id = db.pageIdOf('https://example.com/cats')!
      db.setNote(id, null, NOW)
      expect(titles('cafe')).toEqual([])
      db.delete(id)
      expect(titles('cats')).toEqual([])
      expect(db.raw('SELECT count(*) AS n FROM visits WHERE page_id = ?', id)).toEqual([{ n: 0 }])
    })
  })

  it('moves a visit to the page of its rel=canonical and drops the empty page', () => {
    const { pageId, visitId } = visit('https://example.com/a?session=1', NOW, 'typed')
    db.addDwell(visitId, 4000)
    const target = db.moveVisit(visitId, 'https://example.com/a')
    expect(target).not.toBe(pageId)
    expect(db.page(pageId)).toBeNull()
    expect(db.raw('SELECT url, visit_count, typed_count, dwell_ms FROM pages')).toEqual([
      { url: 'https://example.com/a', visit_count: 1, typed_count: 1, dwell_ms: 4000 },
    ])
    expect(db.raw('SELECT page_id FROM visits')).toEqual([{ page_id: target }])
  })

  it('keeps a noted page when its only visit moves away', () => {
    const { pageId, visitId } = visit('https://example.com/a?session=1')
    db.setNote(pageId, 'keep me', NOW)
    db.moveVisit(visitId, 'https://example.com/a')
    expect(db.page(pageId)).toMatchObject({ note: 'keep me', visitCount: 0 })
  })

  it('clear keeps noted pages and their notes; clear all removes everything', () => {
    const noted = visit('https://example.com/noted')
    db.addDwell(noted.visitId, HIGH_DWELL_MS)
    db.setMeta(noted.pageId, meta({ title: 'Noted', text: 'secret words' }), NOW)
    db.setScreenshot(noted.pageId, new Uint8Array([1]), NOW)
    db.setNote(noted.pageId, 'important', NOW)
    visit('https://example.com/plain')

    db.clear(false)
    expect(db.raw('SELECT url, note, text, screenshot, visit_count FROM pages')).toEqual([
      {
        url: 'https://example.com/noted',
        note: 'important',
        text: null,
        screenshot: null,
        visit_count: 0,
      },
    ])
    expect(db.raw('SELECT count(*) AS n FROM visits')).toEqual([{ n: 0 }])
    expect(db.search(ftsQuery('secret'), { bookmarked: false, limit: 5 })).toEqual([])
    expect(db.search(ftsQuery('important'), { bookmarked: true, limit: 5 })).toHaveLength(1)

    db.clear(true)
    expect(db.raw('SELECT count(*) AS n FROM pages')).toEqual([{ n: 0 }])
  })

  it('lists recently described pages and candidates for semantic search', () => {
    const a = visit('https://example.com/a', NOW - DAY)
    visit('https://example.com/b', NOW)
    db.setNote(a.pageId, 'note', NOW)
    expect(db.recentDescribed(10)).toEqual([a.pageId])
    expect(db.candidates([a.pageId, 999])).toEqual([
      expect.objectContaining({ id: a.pageId, url: 'https://example.com/a', note: 'note' }),
    ])
    expect(db.pages([999, a.pageId], true).map((page) => page.id)).toEqual([a.pageId])
  })

  it('lists recent pages with a screenshot for recall by sketch', () => {
    const a = visit('https://example.com/a', NOW - DAY)
    const b = visit('https://example.com/b', NOW)
    visit('https://example.com/c', NOW)
    for (const { visitId, pageId } of [a, b]) {
      db.addDwell(visitId, HIGH_DWELL_MS)
      db.setScreenshot(pageId, new Uint8Array([0xff, 0xd8]), NOW)
    }
    expect(db.recentWithScreenshot(10)).toEqual([b.pageId, a.pageId])
    expect(db.recentWithScreenshot(1)).toEqual([b.pageId])
    expect(db.candidates([a.pageId])).toEqual([expect.objectContaining({ hasScreenshot: true })])
    expect(
      db
        .explain(
          'SELECT id FROM pages WHERE screenshot_at IS NOT NULL ORDER BY last_visit_at DESC LIMIT 5',
        )
        .join(' '),
    ).toMatch(/pages_last_visit/)
  })
})

describe('HistoryDb on disk', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'antimony-history-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('persists across reopening, in WAL mode', () => {
    const file = join(dir, 'history.sqlite')
    const first = new HistoryDb(file)
    first.startVisit({
      url: 'https://example.com/',
      title: 'Example',
      transition: 'typed',
      at: NOW,
      referrerPageId: null,
    })
    expect(first.raw('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }])
    first.close()
    const second = new HistoryDb(file)
    expect(second.suggest('example', 8, NOW)).toEqual([
      { url: 'https://example.com/', title: 'Example' },
    ])
    second.close()
  })

  it('refuses a database from a newer version', () => {
    const file = join(dir, 'history.sqlite')
    const first = new HistoryDb(file)
    first.raw('PRAGMA user_version = 99')
    first.close()
    expect(() => new HistoryDb(file)).toThrow(/newer/)
  })

  it('lists the most recent pages for the map, filtered by time and text, with followed links', () => {
    const a = visit('https://example.com/lions', NOW - 2 * DAY)
    const b = visit('https://example.com/zoo', NOW - DAY)
    const c = visit('https://other.org/50%_off', NOW)
    db.setMeta(a.pageId, meta({ title: 'Lions', keywords: 'lions, savanna' }), NOW)
    db.startVisit({
      url: 'https://example.com/zoo',
      title: '',
      transition: 'link',
      at: NOW,
      referrerPageId: a.pageId,
    })

    const all = db.mapPages(null, '', 10)
    expect(all.total).toBe(3)
    expect(all.rows.map((row) => row.id)).toEqual([c.pageId, b.pageId, a.pageId])
    expect(all.rows[2]).toMatchObject({ domain: 'example.com', keywords: 'lions, savanna' })
    expect(db.mapPages(NOW - 1.5 * DAY, '', 10).rows.map((row) => row.id)).toEqual([
      c.pageId,
      b.pageId,
    ])
    expect(db.mapPages(null, 'savanna', 10).rows.map((row) => row.id)).toEqual([a.pageId])
    expect(db.mapPages(null, '50%_', 10).rows.map((row) => row.id)).toEqual([c.pageId])
    expect(db.mapPages(null, '%', 10).total).toBe(1)
    expect(db.mapPages(null, '', 2)).toMatchObject({ total: 3, rows: [{ id: c.pageId }, {}] })
    expect(db.follows([a.pageId, b.pageId, c.pageId])).toEqual([
      { from: a.pageId, to: b.pageId, count: 1 },
    ])
    expect(db.follows([b.pageId, c.pageId])).toEqual([])
    expect(db.follows([])).toEqual([])
  })
})
