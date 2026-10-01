// Turns page view events into visits: which navigations count, when a single-page app's URL
// change is a new page, and how much active time each visit gets.
import { HIGH_DWELL_MS } from '../ipc'
import { canonicalUrl } from '../shared/canonical-url'
import type { HistoryDb, Transition } from './db'

/** An in-page URL must stay this long to become a visit. */
export const SETTLE_MS = 3_000
/** An in-page URL change counts only this soon after the user's input (click, key, tap). */
export const INPUT_WINDOW_MS = 10_000
/** In-page visits per origin allowed within RATE_WINDOW_MS; more are runaway pushState. */
export const RATE_LIMIT = 60
export const RATE_WINDOW_MS = 5 * 60_000
/** Dwell is written to the database at least this often. */
export const FLUSH_MS = 15_000
/** Longest time credited between two checks (a missed tick, a sleeping machine). */
const MAX_STEP_MS = 15_000

export interface Visit {
  visitId: number
  pageId: number
  /** Canonical URL. */
  url: string
  /** Active time of this visit so far, milliseconds. */
  dwellMs: number
}

export interface RecorderDeps {
  db: Pick<HistoryDb, 'startVisit' | 'addDwell' | 'setTitle' | 'setStatus'>
  now: () => number
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  /** A visit's active time reached HIGH_DWELL_MS (its dwell is already flushed). */
  onHighDwell: (visit: Visit) => void
  /** A visit started (single-page app visits get no load event to read metadata on). */
  onVisitStarted?: (visit: Visit, transition: Transition) => void
}

interface Current extends Visit {
  highDwell: boolean
  unflushed: number
}

export class Recorder {
  private current: Current | null = null
  private pending: { url: string; title: string | null; timer: unknown } | null = null
  private active = false
  private lastAccrue: number
  private lastFlush: number
  private readonly inPageTimes = new Map<string, number[]>()

  constructor(private readonly deps: RecorderDeps) {
    this.lastAccrue = deps.now()
    this.lastFlush = this.lastAccrue
  }

  /** The visit shown in the page view, if it is recorded. */
  visit(): Visit | null {
    if (!this.current) return null
    const { visitId, pageId, url, dwellMs } = this.current
    return { visitId, pageId, url, dwellMs }
  }

  /** The visit moved to another page (rel=canonical applied). */
  moved(visitId: number, pageId: number, url: string): void {
    if (this.current?.visitId !== visitId) return
    this.current.pageId = pageId
    this.current.url = url
  }

  /** A main-frame navigation committed. */
  navigated(rawUrl: string, status: number, transition: Transition): void {
    this.cancelPending()
    this.accrue()
    const url = canonicalUrl(rawUrl)
    const previous = this.current
    // A reload continues the visit.
    if (transition === 'reload' && previous && url === previous.url) {
      if (status > 0) this.deps.db.setStatus(previous.pageId, status)
      return
    }
    this.end()
    if (url === null || status >= 400) return
    const referrer =
      transition === 'link' || transition === 'assistant' ? (previous?.pageId ?? null) : null
    this.start(url, transition, referrer)
    if (status > 0 && this.current) this.deps.db.setStatus(this.current.pageId, status)
  }

  /**
   * pushState, replaceState or a fragment change in the main frame, `sinceInputMs` after the
   * user's last input in the page. Changes the user didn't cause (carousels, infinite scroll,
   * timers) aren't new pages.
   */
  navigatedInPage(rawUrl: string, sinceInputMs: number | null): void {
    const url = canonicalUrl(rawUrl)
    if (url !== null && url === this.current?.url) {
      // Back to the visit's own URL (or only the fragment changed).
      this.cancelPending()
      return
    }
    if (url === null) {
      this.cancelPending()
      return
    }
    if (this.pending?.url === url) return
    if (sinceInputMs === null || sinceInputMs > INPUT_WINDOW_MS) return
    this.cancelPending()
    const timer = this.deps.setTimer(() => this.commitPending(), SETTLE_MS)
    this.pending = { url, title: null, timer }
  }

  title(title: string): void {
    // A single-page app changes its title along with the URL; it belongs to the pending page.
    if (this.pending) this.pending.title = title
    else if (this.current) this.deps.db.setTitle(this.current.pageId, title)
  }

  /** Whether the user is looking at the page (window focused and shown, user not idle). */
  setActive(active: boolean): void {
    this.accrue()
    this.active = active
  }

  /** Called every few seconds: credits active time, flushes it, detects high dwell. */
  tick(): void {
    this.accrue()
    const current = this.current
    if (!current) return
    if (this.deps.now() - this.lastFlush >= FLUSH_MS) this.flush()
    if (!current.highDwell && current.dwellMs >= HIGH_DWELL_MS) {
      current.highDwell = true
      this.flush()
      this.deps.onHighDwell(this.visit()!)
    }
  }

  /** Writes unsaved active time. */
  flush(): void {
    this.lastFlush = this.deps.now()
    const current = this.current
    if (!current || current.unflushed <= 0) return
    this.deps.db.addDwell(current.visitId, current.unflushed)
    current.unflushed = 0
  }

  /** Ends the current visit (on quit). */
  dispose(): void {
    this.cancelPending()
    this.accrue()
    this.end()
  }

  private accrue(): void {
    const now = this.deps.now()
    const step = Math.min(Math.max(0, now - this.lastAccrue), MAX_STEP_MS)
    this.lastAccrue = now
    if (!this.active || !this.current) return
    this.current.dwellMs += step
    this.current.unflushed += step
  }

  private start(url: string, transition: Transition, referrerPageId: number | null): void {
    const { pageId, visitId } = this.deps.db.startVisit({
      url,
      title: '',
      transition,
      at: this.deps.now(),
      referrerPageId,
    })
    this.current = { visitId, pageId, url, dwellMs: 0, highDwell: false, unflushed: 0 }
    this.deps.onVisitStarted?.(this.visit()!, transition)
  }

  private end(): void {
    this.flush()
    this.current = null
  }

  private cancelPending(): void {
    if (!this.pending) return
    this.deps.clearTimer(this.pending.timer)
    this.pending = null
  }

  private commitPending(): void {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    const now = this.deps.now()
    const origin = new URL(pending.url).origin
    const recent = (this.inPageTimes.get(origin) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
    if (recent.length >= RATE_LIMIT) {
      this.inPageTimes.set(origin, recent)
      return
    }
    this.inPageTimes.set(origin, [...recent, now])
    this.accrue()
    const previous = this.current
    this.end()
    this.start(pending.url, 'in_page', previous?.pageId ?? null)
    if (pending.title && this.current) this.deps.db.setTitle(this.current.pageId, pending.title)
  }
}
