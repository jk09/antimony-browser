import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIGH_DWELL_MS } from '../ipc'
import { HistoryDb } from './db'
import { INPUT_WINDOW_MS, RATE_LIMIT, Recorder, SETTLE_MS, type Visit } from './recorder'

let now: number
let db: HistoryDb
let timers: { at: number; callback: () => void; id: number }[]
let highDwell: Visit[]
let started: string[]
let recorder: Recorder

/** Moves the clock, firing due timers and a tick every 5 s like main does. */
function advance(ms: number, { ticks = true } = {}) {
  const end = now + ms
  while (now < end) {
    const step = Math.min(5000, end - now)
    const due = now + step
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (timer.at <= due) {
        now = Math.max(now, timer.at)
        timers = timers.filter((t) => t !== timer)
        timer.callback()
      }
    }
    now = due
    if (ticks) recorder.tick()
  }
}

beforeEach(() => {
  now = 1_000_000
  timers = []
  highDwell = []
  started = []
  db = new HistoryDb(':memory:')
  let nextId = 1
  recorder = new Recorder({
    db,
    now: () => now,
    setTimer: (callback, ms) => {
      const id = nextId++
      timers.push({ at: now + ms, callback, id })
      return id
    },
    clearTimer: (id) => {
      timers = timers.filter((timer) => timer.id !== id)
    },
    onHighDwell: (visit) => highDwell.push(visit),
    onVisitStarted: (visit, transition) => started.push(`${transition} ${visit.url}`),
  })
  recorder.setActive(true)
})
afterEach(() => db.close())

const visits = () =>
  db.raw(
    `SELECT p.url, v.transition, v.dwell_ms FROM visits v JOIN pages p ON p.id = v.page_id
     ORDER BY v.id`,
  )

describe('Recorder', () => {
  it('records committed navigations with their transition and referrer', () => {
    recorder.navigated('https://example.com/?utm_source=x', 200, 'typed')
    recorder.navigated('https://example.com/a', 200, 'link')
    recorder.navigated('https://example.com/', 200, 'back_forward')
    recorder.navigated('https://example.com/b', 200, 'assistant')
    expect(visits().map((v) => `${v['transition']} ${v['url']}`)).toEqual([
      'typed https://example.com/',
      'link https://example.com/a',
      'back_forward https://example.com/',
      'assistant https://example.com/b',
    ])
    const referrers = db.raw(
      `SELECT r.url FROM visits v LEFT JOIN pages r ON r.id = v.referrer_page_id ORDER BY v.id`,
    )
    expect(referrers.map((row) => row['url'])).toEqual([
      null,
      'https://example.com/',
      null,
      'https://example.com/',
    ])
  })

  it('continues the visit on reload', () => {
    recorder.navigated('https://example.com/a', 200, 'link')
    advance(10_000)
    recorder.navigated('https://example.com/a#top', 200, 'reload')
    advance(10_000)
    recorder.flush()
    expect(visits()).toEqual([
      { url: 'https://example.com/a', transition: 'link', dwell_ms: 20_000 },
    ])
  })

  it('skips error pages and URLs history does not store', () => {
    recorder.navigated('https://example.com/missing', 404, 'link')
    recorder.navigated('https://example.com/broken', 500, 'link')
    recorder.navigated('about:blank', 200, 'link')
    recorder.navigated('file:///etc/hosts', 0, 'typed')
    expect(visits()).toEqual([])
    expect(recorder.visit()).toBeNull()
  })

  describe('single-page apps', () => {
    beforeEach(() => recorder.navigated('https://app.example/inbox', 200, 'typed'))

    it('ignores fragment-only changes', () => {
      recorder.navigatedInPage('https://app.example/inbox#message-3', 100)
      advance(SETTLE_MS + 1000)
      expect(visits()).toHaveLength(1)
    })

    it('records an in-page URL that stays for the settle time, with the title it got', () => {
      recorder.navigatedInPage('https://app.example/inbox/42', 100)
      recorder.title('Message 42')
      advance(SETTLE_MS)
      expect(visits().map((v) => v['url'])).toEqual([
        'https://app.example/inbox',
        'https://app.example/inbox/42',
      ])
      expect(
        db.raw('SELECT title FROM pages WHERE url = ?', 'https://app.example/inbox/42'),
      ).toEqual([{ title: 'Message 42' }])
      expect(db.raw('SELECT title FROM pages WHERE url = ?', 'https://app.example/inbox')).toEqual([
        { title: '' },
      ])
      expect(started).toEqual([
        'typed https://app.example/inbox',
        'in_page https://app.example/inbox/42',
      ])
    })

    it('drops URLs replaced before they settle (search as you type)', () => {
      for (const q of ['s', 'sq', 'sql', 'sqli', 'sqlite']) {
        recorder.navigatedInPage(`https://app.example/search?q=${q}`, 100)
        advance(500)
      }
      advance(SETTLE_MS)
      expect(visits().map((v) => v['url'])).toEqual([
        'https://app.example/inbox',
        'https://app.example/search?q=sqlite',
      ])
    })

    it('drops a pending URL when the app goes back or a full navigation commits', () => {
      recorder.navigatedInPage('https://app.example/compose', 100)
      advance(1000)
      recorder.navigatedInPage('https://app.example/inbox', 100)
      advance(SETTLE_MS)
      recorder.navigatedInPage('https://app.example/drafts', 100)
      recorder.navigated('https://other.example/', 200, 'link')
      advance(SETTLE_MS)
      expect(visits().map((v) => v['url'])).toEqual([
        'https://app.example/inbox',
        'https://other.example/',
      ])
    })

    it('ignores URL changes the user did not cause (carousels, infinite scroll)', () => {
      recorder.navigatedInPage('https://app.example/inbox?page=2', null)
      advance(SETTLE_MS)
      recorder.navigatedInPage('https://app.example/inbox?page=3', INPUT_WINDOW_MS + 1)
      advance(SETTLE_MS)
      expect(visits()).toHaveLength(1)
    })

    it('stops recording runaway pushState after the rate limit', () => {
      for (let i = 0; i < RATE_LIMIT + 10; i++) {
        recorder.navigatedInPage(`https://app.example/item/${i}`, 100)
        advance(SETTLE_MS, { ticks: false })
      }
      expect(visits()).toHaveLength(1 + RATE_LIMIT)
    })
  })

  describe('dwell time', () => {
    beforeEach(() => recorder.navigated('https://example.com/a', 200, 'link'))

    it('counts only active time', () => {
      advance(10_000)
      recorder.setActive(false)
      advance(60_000)
      recorder.setActive(true)
      advance(5_000)
      recorder.navigated('https://example.com/b', 200, 'link')
      expect(visits()[0]).toMatchObject({ dwell_ms: 15_000 })
    })

    it('credits at most 15 s between two checks (a sleeping machine)', () => {
      now += 3_600_000
      recorder.tick()
      recorder.flush()
      expect(visits()[0]).toMatchObject({ dwell_ms: 15_000 })
    })

    it('flushes at least every 15 s', () => {
      advance(20_000)
      expect(Number(visits()[0]!['dwell_ms'])).toBeGreaterThanOrEqual(15_000)
    })

    it('reports high dwell once per visit, after flushing it', () => {
      advance(HIGH_DWELL_MS - 5000)
      expect(highDwell).toEqual([])
      advance(5000)
      expect(highDwell).toHaveLength(1)
      expect(highDwell[0]).toMatchObject({ url: 'https://example.com/a', dwellMs: HIGH_DWELL_MS })
      expect(db.raw('SELECT max_dwell_ms FROM pages')).toEqual([{ max_dwell_ms: HIGH_DWELL_MS }])
      advance(60_000)
      expect(highDwell).toHaveLength(1)
    })

    it('does not count dwell across visits: two short visits are not high dwell', () => {
      advance(20_000)
      recorder.navigated('https://example.com/b', 200, 'link')
      recorder.navigated('https://example.com/a', 200, 'link')
      advance(20_000)
      expect(highDwell).toEqual([])
    })

    it('writes the remaining dwell on dispose', () => {
      advance(4000, { ticks: false })
      recorder.dispose()
      expect(visits()[0]).toMatchObject({ dwell_ms: 4000 })
      expect(recorder.visit()).toBeNull()
    })
  })

  it('follows a visit moved to its canonical page', () => {
    recorder.navigated('https://example.com/a?session=1', 200, 'link')
    const visit = recorder.visit()!
    const pageId = db.moveVisit(visit.visitId, 'https://example.com/a')
    recorder.moved(visit.visitId, pageId, 'https://example.com/a')
    recorder.navigatedInPage('https://example.com/a#x', 100)
    advance(SETTLE_MS)
    expect(visits()).toHaveLength(1)
    expect(recorder.visit()).toMatchObject({ pageId, url: 'https://example.com/a' })
  })

  it('stays usable when history is cleared under it', () => {
    recorder.navigated('https://example.com/a', 200, 'link')
    db.clear(true)
    advance(20_000)
    recorder.title('Still fine')
    expect(() => recorder.flush()).not.toThrow()
    vi.restoreAllMocks()
  })
})
