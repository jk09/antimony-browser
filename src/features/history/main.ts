import { renameSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, powerMonitor } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { complete } from '../agent/main'
import { getPage, getTabs, onPageEvent } from '../navigation/main'
import {
  channels,
  MAX_NOTE,
  MAX_QUERY,
  MAX_SKETCH,
  type HistorySettings,
  type OpenRequest,
  type RecalledPage,
  type RecallRequest,
  type RecallResult,
  type SearchMode,
  type SearchRequest,
  type SearchResult,
} from './ipc'
import { HistoryDb } from './main/db'
import {
  aggregateKeywords,
  MAX_SCREENSHOTS,
  parseRecall,
  RECALL_LIMIT,
  RECALL_SYSTEM,
  recallPrompt,
  SCREENSHOT_SEND_WIDTH,
  titleKeywords,
  VISUAL_CANDIDATES,
  type RecallPick,
} from './main/recall'
import { Recorder, type Visit } from './main/recorder'
import {
  MATCH_CANDIDATES,
  parseRanking,
  rankingPrompt,
  RECENT_CANDIDATES,
  SEMANTIC_SYSTEM,
} from './main/semantic'
import { needsSummary, parseSummary, SUMMARY_SYSTEM, summaryPrompt } from './main/summarize'
import { adoptCanonicalLink, canonicalUrl } from './shared/canonical-url'
import { ftsQuery } from './shared/fts-query'
import { readPageMeta, scriptSource, type PageMeta } from './shared/page-meta'

/** Isolated world for history's page script (the agent uses 1001). */
const WORLD_ID = 1002
const TICK_MS = 5_000
const IDLE_SECONDS = 60
const MAX_TEXT = 50_000
const SCREENSHOT_WIDTH = 800
const SUGGEST_LIMIT = 8
const SEARCH_LIMIT = 50
const MODEL_TIMEOUT_MS = 60_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('id must be a positive integer')
  }
  return value
}

export function parseSearch(value: unknown): SearchRequest {
  if (!isRecord(value))
    throw new TypeError(`${channels.search} expects { query, mode, bookmarked }`)
  const { query, mode, bookmarked } = value
  if (typeof query !== 'string' || query.length > MAX_QUERY) {
    throw new TypeError(`query must be a string of up to ${MAX_QUERY} characters`)
  }
  if (mode !== 'text' && mode !== 'semantic') throw new TypeError('mode must be text or semantic')
  if (typeof bookmarked !== 'boolean') throw new TypeError('bookmarked must be a boolean')
  return { query, mode: mode as SearchMode, bookmarked }
}

export function parseNote(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > MAX_NOTE) {
    throw new TypeError(`a note is a string of up to ${MAX_NOTE} characters, or null`)
  }
  return value
}

export function parseOpen(value: unknown): OpenRequest {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new TypeError('expected { query?, note? }')
  const request: OpenRequest = {}
  for (const key of Object.keys(value)) {
    if (key !== 'query' && key !== 'note') throw new TypeError(`unknown field ${key}`)
  }
  if (value['query'] !== undefined) {
    if (typeof value['query'] !== 'string' || value['query'].length > MAX_QUERY) {
      throw new TypeError('query must be a short string')
    }
    request.query = value['query']
  }
  if (value['note'] !== undefined) {
    if (typeof value['note'] !== 'boolean') throw new TypeError('note must be a boolean')
    request.note = value['note']
  }
  return request
}

const SKETCH_PREFIX = 'data:image/jpeg;base64,'

export function parseRecallRequest(value: unknown): RecallRequest {
  if (!isRecord(value)) throw new TypeError(`${channels.recall} expects { query, sketch }`)
  for (const key of Object.keys(value)) {
    if (key !== 'query' && key !== 'sketch') throw new TypeError(`unknown field ${key}`)
  }
  const { query, sketch } = value
  if (typeof query !== 'string' || query.length > MAX_QUERY) {
    throw new TypeError(`query must be a string of up to ${MAX_QUERY} characters`)
  }
  if (sketch !== null) {
    if (
      typeof sketch !== 'string' ||
      sketch.length > MAX_SKETCH ||
      !sketch.startsWith(SKETCH_PREFIX) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(sketch.slice(SKETCH_PREFIX.length))
    ) {
      throw new TypeError(
        `sketch must be a JPEG data URL of up to ${MAX_SKETCH} characters, or null`,
      )
    }
  }
  if (!query.trim() && sketch === null) throw new TypeError('recall needs a query or a sketch')
  return { query: query.trim(), sketch }
}

function parseSettingsUpdate(value: unknown): Partial<HistorySettings> {
  if (!isRecord(value)) throw new TypeError('expected a settings object')
  for (const key of Object.keys(value)) {
    if (key !== 'summaries') throw new TypeError(`unknown setting ${key}`)
  }
  if ('summaries' in value && typeof value['summaries'] !== 'boolean') {
    throw new TypeError('summaries must be a boolean')
  }
  return value as Partial<HistorySettings>
}

function parseStoredSettings(raw: unknown): HistorySettings {
  if (!isRecord(raw)) throw new TypeError('settings must be an object')
  return { summaries: raw['summaries'] === true }
}

/** Opens the database; a file that can't be opened is moved aside so history starts afresh. */
function openDb(file: string): HistoryDb {
  try {
    return new HistoryDb(file)
  } catch (error) {
    const aside = `${file}.corrupt-${Date.now()}`
    console.warn(`${file} can't be opened, moved to ${aside}`, error)
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        renameSync(`${file}${suffix}`, `${aside}${suffix}`)
      } catch {
        // Missing -wal / -shm files are fine.
      }
    }
    return new HistoryDb(file)
  }
}

const withTimeout = () => AbortSignal.timeout(MODEL_TIMEOUT_MS)

const clearedListeners = new Set<(all: boolean) => void>()

/** Called after the user clears browsing history (`all`: noted pages too). For stacks. */
export function onHistoryCleared(listener: (all: boolean) => void): () => void {
  clearedListeners.add(listener)
  return () => clearedListeners.delete(listener)
}

export function register({ window, ipc, fileMenu }: MainContext): void {
  const userData = app.getPath('userData')
  const db = openDb(join(userData, 'history.sqlite'))
  const settings = createJsonStore(join(userData, 'history-settings.json'), {
    parse: parseStoredSettings,
    fallback: (): HistorySettings => ({ summaries: false }),
  })

  /** Reads metadata and text of the page view, if it still shows `visit`. */
  const readMeta = async (visit: Visit): Promise<PageMeta | null> => {
    const contents = getPage()?.contents()
    if (!contents || recorder.visit()?.visitId !== visit.visitId) return null
    try {
      const meta = (await contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [
        { code: scriptSource(readPageMeta, { maxText: MAX_TEXT, maxField: 1000 }) },
      ])) as PageMeta
      // The page may have changed while the script ran.
      return recorder.visit()?.visitId === visit.visitId ? meta : null
    } catch (error) {
      console.warn('Could not read page metadata', error)
      return null
    }
  }

  /** Stores metadata; applies the page's rel=canonical. Returns the visit's (new) page id. */
  const storeMeta = (visit: Visit, meta: PageMeta): number => {
    let pageId = visit.pageId
    const adopted = adoptCanonicalLink(visit.url, meta.canonicalLink)
    if (adopted !== null) {
      pageId = db.moveVisit(visit.visitId, adopted)
      recorder.moved(visit.visitId, pageId, adopted)
    }
    db.setMeta(pageId, meta, Date.now())
    return pageId
  }

  const captureScreenshot = async (pageId: number): Promise<string | null> => {
    const contents = getPage()?.contents()
    if (!contents) return null
    const image = await contents.capturePage()
    if (image.isEmpty()) return null
    const { width } = image.getSize()
    const jpeg = (
      width > SCREENSHOT_WIDTH ? image.resize({ width: SCREENSHOT_WIDTH }) : image
    ).toJPEG(70)
    db.setScreenshot(pageId, jpeg, Date.now())
    return jpeg.toString('base64')
  }

  // One summary at a time, in the order pages reached high dwell.
  let summaries = Promise.resolve()
  const summarize = (pageId: number, screenshot: string | null) => {
    summaries = summaries.then(async () => {
      // The database may be closed (quit) or the page deleted by now.
      let source: ReturnType<typeof db.summarySource> = null
      try {
        source = db.summarySource(pageId)
      } catch {
        return
      }
      if (!source || !needsSummary(source, Date.now())) return
      try {
        const answer = await complete({
          system: SUMMARY_SYSTEM,
          text: summaryPrompt(source),
          ...(screenshot && { imageJpegBase64: screenshot }),
          signal: withTimeout(),
        })
        const parsed = parseSummary(answer.text)
        if (!parsed) return
        db.setSummary(
          pageId,
          { ...parsed, model: answer.model, textHash: source.textHash },
          Date.now(),
        )
      } catch (error) {
        console.warn(`Could not summarise ${source.url}`, error)
      }
    })
  }

  /** Reads and stores the page's metadata; returns it with the visit's page id. */
  const refreshMeta = async (visit: Visit) => {
    const meta = await readMeta(visit)
    if (!meta) return null
    try {
      return { meta, pageId: storeMeta(visit, meta) }
    } catch (error) {
      // The page was deleted from history meanwhile, say.
      console.warn('Could not store page metadata', error)
      return null
    }
  }

  const onHighDwell = async (visit: Visit) => {
    const stored = await refreshMeta(visit)
    if (!stored) return
    const { meta, pageId } = stored
    if (meta.sensitive) return
    let screenshot: string | null = null
    try {
      if (db.needsScreenshot(pageId, Date.now())) screenshot = await captureScreenshot(pageId)
    } catch (error) {
      console.warn('Could not capture the page', error)
    }
    if (settings.get().summaries) summarize(pageId, screenshot)
  }

  const recorder = new Recorder({
    db,
    now: Date.now,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onHighDwell: (visit) => void onHighDwell(visit),
    // Metadata is read when a page loads or a single-page app changes page, and again at high
    // dwell (content rendered late, the text of a page the user stayed on).
    onVisitStarted: (visit, transition) => {
      if (transition === 'in_page') void refreshMeta(visit)
    },
  })

  // Visits follow the active tab: background tabs aren't recorded until they're shown.
  onPageEvent((event) => {
    if (event.type === 'activated') {
      const url = canonicalUrl(event.url)
      if (url !== null && recorder.visit()?.url !== url) {
        recorder.navigated(event.url, 200, 'back_forward')
      }
      return
    }
    if (event.tabId !== getTabs()?.active()) return
    switch (event.type) {
      case 'navigated':
        recorder.navigated(event.url, event.status, event.transition)
        return
      case 'navigated-in-page':
        recorder.navigatedInPage(event.url, event.sinceInputMs)
        return
      case 'title':
        recorder.title(event.title)
        return
      case 'loaded': {
        const visit = recorder.visit()
        if (visit) void refreshMeta(visit)
        return
      }
    }
  })

  // Dwell counts while the window is focused and shown and the user isn't idle or locked away.
  let locked = false
  const refreshActivity = () => {
    const shown = !window.isDestroyed() && window.isVisible() && !window.isMinimized()
    const idle = powerMonitor.getSystemIdleTime() >= IDLE_SECONDS
    recorder.setActive(shown && window.isFocused() && !idle && !locked)
  }
  for (const event of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide'] as const) {
    window.on(event as 'focus', refreshActivity)
  }
  powerMonitor.on('lock-screen', () => {
    locked = true
    refreshActivity()
  })
  powerMonitor.on('unlock-screen', () => {
    locked = false
    refreshActivity()
  })
  powerMonitor.on('suspend', () => recorder.setActive(false))
  const ticker = setInterval(() => {
    if (window.isDestroyed()) return
    refreshActivity()
    recorder.tick()
  }, TICK_MS)
  app.on('will-quit', () => {
    clearInterval(ticker)
    recorder.dispose()
    settings.flush()
    db.close()
  })

  const changed = () => ipc.send(channels.changed, null)

  const textSearch = (query: string, bookmarked: boolean) =>
    db.search(ftsQuery(query), { bookmarked, limit: SEARCH_LIMIT })

  const semanticSearch = async (query: string, bookmarked: boolean): Promise<SearchResult> => {
    const or = ftsQuery(query, 'or')
    const matched = or
      ? db.search(or, { bookmarked, limit: MATCH_CANDIDATES }).map((p) => p.id)
      : []
    const ids = [...new Set([...matched, ...db.recentDescribed(RECENT_CANDIDATES)])]
    const candidates = db.candidates(ids).filter((page) => !bookmarked || page.note !== null)
    if (candidates.length === 0) return { pages: [] }
    try {
      const answer = await complete({
        system: SEMANTIC_SYSTEM,
        text: rankingPrompt(query, candidates),
        signal: withTimeout(),
      })
      const ranked = parseRanking(answer.text, new Set(candidates.map((page) => page.id)))
      if (ranked === null) throw new Error('the model did not answer with a list of pages')
      return { pages: db.pages(ranked, bookmarked) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        pages: textSearch(query, bookmarked),
        notice: `Search by meaning failed (${reason}); showing text matches.`,
      }
    }
  }

  /** A stored screenshot, scaled down to send to the model, base64; null if there's none. */
  const smallScreenshot = (pageId: number): string | null => {
    const jpeg = db.screenshot(pageId)
    if (!jpeg) return null
    const image = nativeImage.createFromBuffer(Buffer.from(jpeg))
    if (image.isEmpty()) return null
    const small =
      image.getSize().width > SCREENSHOT_SEND_WIDTH
        ? image.resize({ width: SCREENSHOT_SEND_WIDTH })
        : image
    return small.toJPEG(60).toString('base64')
  }

  const recalled = (picks: RecallPick[]): RecalledPage[] => {
    const byId = new Map(picks.map((pick) => [pick.id, pick]))
    return db.pages(picks.map((pick) => pick.id)).map((page) => {
      const pick = byId.get(page.id)!
      return { ...page, score: pick.score, keywords: pick.keywords }
    })
  }

  let recalling: AbortController | null = null

  const recall = async ({ query, sketch }: RecallRequest): Promise<RecallResult> => {
    recalling?.abort()
    const controller = new AbortController()
    recalling = controller
    const view = sketch ? 'images' : 'words'
    const or = query ? ftsQuery(query, 'or') : null
    const matched = or
      ? db.search(or, { bookmarked: false, limit: MATCH_CANDIDATES }).map((p) => p.id)
      : []
    const visual = sketch ? db.recentWithScreenshot(VISUAL_CANDIDATES) : []
    const ids = [...new Set([...matched, ...visual, ...db.recentDescribed(RECENT_CANDIDATES)])]
    const candidates = db.candidates(ids)
    if (candidates.length === 0) return { view, pages: [], keywords: [] }
    try {
      const images = sketch
        ? [
            { label: 'Sketch:', jpegBase64: sketch.slice(SKETCH_PREFIX.length) },
            ...candidates
              .filter((page) => page.hasScreenshot)
              .flatMap((page) => {
                const jpegBase64 = smallScreenshot(page.id)
                return jpegBase64 ? [{ label: `Screenshot of page ${page.id}:`, jpegBase64 }] : []
              })
              .slice(0, MAX_SCREENSHOTS),
          ]
        : []
      const answer = await complete({
        system: RECALL_SYSTEM,
        text: recallPrompt(query, candidates, sketch !== null),
        ...(images.length > 0 && { images }),
        signal: AbortSignal.any([controller.signal, withTimeout()]),
      })
      const parsed = parseRecall(answer.text, new Set(candidates.map((page) => page.id)))
      if (parsed === null) throw new Error('the model did not answer with a list of pages')
      return {
        view: parsed.view ?? view,
        pages: recalled(parsed.pages),
        keywords: aggregateKeywords(parsed.pages),
      }
    } catch (error) {
      if (controller.signal.aborted) return { view, pages: [], keywords: [] }
      const reason = error instanceof Error ? error.message : String(error)
      if (!query) return { view, pages: [], keywords: [], notice: `Recall failed (${reason}).` }
      const pages = textSearch(query, false).slice(0, RECALL_LIMIT)
      const picks = pages.map((page, index) => ({
        id: page.id,
        score: 1 - index / Math.max(pages.length, 1),
        keywords: titleKeywords(page.title),
      }))
      return {
        view,
        pages: recalled(picks),
        keywords: aggregateKeywords(picks),
        notice: `Recall by meaning failed (${reason}); showing text matches.`,
      }
    } finally {
      if (recalling === controller) recalling = null
    }
  }

  ipc.handle(channels.suggest, (text) => {
    if (typeof text !== 'string' || text.length > MAX_QUERY) {
      throw new TypeError(`${channels.suggest} expects a short string`)
    }
    return db.suggest(text, SUGGEST_LIMIT, Date.now())
  })
  ipc.handle(channels.search, (value): SearchResult | Promise<SearchResult> => {
    const { query, mode, bookmarked } = parseSearch(value)
    if (mode === 'semantic' && query.trim()) return semanticSearch(query.trim(), bookmarked)
    return { pages: textSearch(query, bookmarked) }
  })
  ipc.handle(channels.screenshot, (id) => {
    const jpeg = db.screenshot(parseId(id))
    return jpeg ? `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}` : null
  })
  ipc.handle(channels.current, () => {
    const visit = recorder.visit()
    return visit ? db.page(visit.pageId) : null
  })
  ipc.handle(channels.setNote, (id, note) => {
    if (!db.setNote(parseId(id), parseNote(note), Date.now())) {
      throw new TypeError('That page is no longer in history.')
    }
    changed()
  })
  ipc.handle(channels.delete, (id) => {
    db.delete(parseId(id))
    changed()
  })
  ipc.handle(channels.clear, (all) => {
    if (typeof all !== 'boolean') throw new TypeError(`${channels.clear} expects a boolean`)
    recorder.dispose()
    db.clear(all)
    changed()
    for (const listener of clearedListeners) listener(all)
  })
  ipc.handle(channels.settings, () => settings.get())
  ipc.handle(channels.updateSettings, (value) => {
    settings.set({ ...settings.get(), ...parseSettingsUpdate(value) })
    ipc.send(channels.settingsChanged, settings.get())
    return settings.get()
  })
  ipc.handle(channels.requestOpen, (value) => ipc.send(channels.open, parseOpen(value)))
  ipc.handle(channels.recall, (value) => recall(parseRecallRequest(value)))
  ipc.handle(channels.cancelRecall, () => {
    recalling?.abort()
  })
  ipc.handle(channels.requestRecall, (query) => {
    if (typeof query !== 'string' || query.length > MAX_QUERY) {
      throw new TypeError(`${channels.requestRecall} expects a short string`)
    }
    ipc.send(channels.openRecall, query)
  })

  fileMenu.push({
    id: 'note-page',
    label: 'Note This Page…',
    accelerator: 'CmdOrCtrl+D',
    click: () => {
      window.webContents.focus()
      ipc.send(channels.open, { note: true } satisfies OpenRequest)
    },
  })
  fileMenu.push({
    id: 'recall',
    label: 'Recall from History…',
    accelerator: 'CmdOrCtrl+Shift+Y',
    click: () => {
      window.webContents.focus()
      ipc.send(channels.openRecall, '')
    },
  })
}
