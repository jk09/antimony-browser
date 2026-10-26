import { join } from 'node:path'
import { app, Menu, session, type Session, type WebContents } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { complete } from '../agent/main'
import { getPage, getTabs, onPageEvent } from '../navigation/main'
import { channels, type LinkSummariesSettings } from './ipc'
import { SummaryCache } from './main/cache'
import { mapLimit, prefetchHtml, type Fetcher } from './main/prefetch'
import {
  LINK_SUMMARY_SYSTEM,
  linkSummaryPrompt,
  parseLinkSummaries,
  type SummarySource,
} from './main/summarize'
import { extractPage } from './shared/extract'
import {
  markLinks,
  scanLinks,
  scriptSource,
  unmarkLinks,
  type LinkSummary,
  type Scan,
  type ScanLimits,
} from './shared/page-scripts'

const WORLD_ID = 1003
/** The in-memory session prefetching uses: no `persist:`, nothing shared with the browsing session. */
export const PREFETCH_PARTITION = 'link-summaries'
export const MENU_ID = 'link-summaries'
const LIMITS: ScanLimits = { minText: 1500, maxLinks: 300, maxTargets: 20 }
const MAX_URL = 2048
const PARALLEL_FETCHES = 4
const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 1_000_000
const MAX_PAGE_TEXT = 1500
const MODEL_TIMEOUT_MS = 90_000
const TOOLTIP_DELAY_MS = 300

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isWebUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_URL && /^https?:\/\//i.test(value)

export function parseSettingsUpdate(value: unknown): Partial<LinkSummariesSettings> {
  if (!isRecord(value)) throw new TypeError('expected a settings object')
  for (const key of Object.keys(value)) {
    if (key !== 'enabled') throw new TypeError(`unknown setting ${key}`)
  }
  if ('enabled' in value && typeof value['enabled'] !== 'boolean') {
    throw new TypeError('enabled must be a boolean')
  }
  return value as Partial<LinkSummariesSettings>
}

function parseStoredSettings(raw: unknown): LinkSummariesSettings {
  if (!isRecord(raw)) throw new TypeError('settings must be an object')
  return { enabled: raw['enabled'] === true }
}

/** What the page script answered, checked: it runs in the page's renderer. */
export function parseScan(value: unknown): Scan | null {
  if (!isRecord(value) || !isWebUrl(value['url']) || value['simple'] !== true) return null
  const targets = value['targets']
  if (!Array.isArray(targets)) return null
  return {
    url: value['url'],
    simple: true,
    targets: [...new Set(targets.filter(isWebUrl))].slice(0, LIMITS.maxTargets),
  }
}

export function register({ ipc, fileMenu }: MainContext): void {
  const store = createJsonStore(join(app.getPath('userData'), 'link-summaries.json'), {
    parse: parseStoredSettings,
    fallback: (): LinkSummariesSettings => ({ enabled: false }),
  })
  const cache = new SummaryCache()
  let prefetchSession: Session | null = null
  const fetcher: Fetcher = (url, init) => {
    prefetchSession ??= session.fromPartition(PREFETCH_PARTITION, { cache: false })
    return prefetchSession.fetch(url, init)
  }
  /** Pages that may carry marks, so turning the mode off can clear them when they're shown. */
  const marked = new WeakSet<WebContents>()
  // Each navigation or tab switch starts a new generation; older runs drop their results.
  let generation = 0
  let running: AbortController | null = null

  const cancel = () => {
    generation++
    running?.abort()
    running = null
  }

  const run = (contents: WebContents, script: string) =>
    contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: script }])

  /** Prefetches and summarises the targets the cache doesn't know yet. */
  const summarize = async (targets: string[], signal: AbortSignal) => {
    const missing = targets.filter((url) => !cache.has(url))
    if (missing.length === 0) return
    const fetched = await mapLimit(missing, PARALLEL_FETCHES, async (url) => {
      const html = await prefetchHtml(fetcher, url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_BYTES,
        signal,
      })
      return html === null ? null : { url, ...extractPage(html, MAX_PAGE_TEXT) }
    })
    if (signal.aborted) return
    const sources: SummarySource[] = []
    fetched.forEach((page, index) => {
      if (page && (page.text || page.description)) sources.push(page)
      else cache.set(missing[index]!, null)
    })
    if (sources.length === 0) return
    // A failed request caches nothing, so the next page asks again.
    const answer = await complete({
      system: LINK_SUMMARY_SYSTEM,
      text: linkSummaryPrompt(sources),
      signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
    })
    if (signal.aborted) return
    const summaries = parseLinkSummaries(answer.text, sources.length)
    sources.forEach((page, index) => {
      const summary = summaries.get(index + 1)
      cache.set(page.url, summary ? { title: page.title, summary } : null)
    })
  }

  /** Scans the active tab's page and, if it is simple, marks the links that have a summary. */
  const scan = async () => {
    cancel()
    if (!store.get().enabled) return
    const contents = getPage()?.contents()
    if (!contents || contents.isDestroyed()) return
    const token = generation
    const controller = new AbortController()
    running = controller
    const current = () =>
      token === generation && !contents.isDestroyed() && getPage()?.contents() === contents
    try {
      const found = parseScan(await run(contents, scriptSource(scanLinks, LIMITS)))
      if (!found || found.targets.length === 0 || !current()) return
      await summarize(found.targets, controller.signal)
      if (!current()) return
      const summaries: LinkSummary[] = []
      for (const url of found.targets) {
        const entry = cache.get(url)
        if (entry) summaries.push({ url, ...entry })
      }
      if (summaries.length === 0) return
      marked.add(contents)
      await run(contents, scriptSource(markLinks, { summaries, delayMs: TOOLTIP_DELAY_MS }))
    } catch (error) {
      if (!controller.signal.aborted) console.warn('Link summaries failed', error)
    } finally {
      if (running === controller) running = null
    }
  }

  const unmark = (contents: WebContents | null | undefined) => {
    if (!contents || contents.isDestroyed() || !marked.has(contents)) return
    marked.delete(contents)
    run(contents, scriptSource(unmarkLinks, undefined)).catch(() => {})
  }

  const setEnabled = (enabled: boolean) => {
    if (enabled !== store.get().enabled) {
      store.set({ ...store.get(), enabled })
      if (enabled) void scan()
      else {
        cancel()
        cache.clear()
        unmark(getPage()?.contents())
        void prefetchSession?.clearStorageData()
      }
    }
    const item = Menu.getApplicationMenu()?.getMenuItemById(MENU_ID)
    if (item) item.checked = enabled
    ipc.send(channels.settingsChanged, store.get())
    return store.get()
  }

  onPageEvent((event) => {
    if (event.type === 'activated') {
      cancel()
      if (store.get().enabled) void scan()
      else unmark(getPage()?.contents())
      return
    }
    if (event.tabId !== getTabs()?.active()) return
    if (event.type === 'navigated') {
      cancel()
      // A new document has no marks; the script's state went with the old one.
      const contents = getPage()?.contents()
      if (contents) marked.delete(contents)
    } else if (event.type === 'loaded') void scan()
  })

  app.on('will-quit', () => {
    cancel()
    store.flush()
  })

  ipc.handle(channels.settings, () => store.get())
  ipc.handle(channels.updateSettings, (value) => {
    const update = parseSettingsUpdate(value)
    return setEnabled(update.enabled ?? store.get().enabled)
  })

  fileMenu.push({
    id: MENU_ID,
    label: 'Link Summaries',
    type: 'checkbox',
    checked: store.get().enabled,
    click: (item) => setEnabled(item.checked),
  })
}
