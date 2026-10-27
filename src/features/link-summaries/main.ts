import { session, type Session } from 'electron'
import type { MainContext } from '../../app/main/features'
import { complete, provideLinkSummaries } from '../agent/main'
import type { LinkSummary } from '../agent/ipc'
import { getPage } from '../navigation/main'
import { mapLimit, prefetchHtml, type Fetcher } from './main/prefetch'
import {
  LINK_SUMMARY_SYSTEM,
  linkSummaryPrompt,
  parseLinkSummaries,
  type SummarySource,
} from './main/summarize'
import { extractPage } from './shared/extract'
import { collectLinks, scriptSource, type PageLinks } from './shared/page-scripts'

const WORLD_ID = 1003
/** The in-memory session prefetching uses: no `persist:`, nothing shared with the browsing session. */
export const PREFETCH_PARTITION = 'link-summaries'
const MAX_LINKS = 20
const MAX_LINK_TEXT = 200
const MAX_URL = 2048
const PARALLEL_FETCHES = 4
const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 1_000_000
const MAX_PAGE_TEXT = 1500
const MODEL_TIMEOUT_MS = 90_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isWebUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_URL && /^https?:\/\//i.test(value)

/** What the page script answered, checked: it ran in the page's renderer. */
export function parseLinks(value: unknown): PageLinks['links'] | null {
  if (!isRecord(value) || !isWebUrl(value['url']) || !Array.isArray(value['links'])) return null
  const links: PageLinks['links'] = []
  for (const link of value['links']) {
    if (!isRecord(link) || !isWebUrl(link['url']) || typeof link['text'] !== 'string') continue
    if (links.some((other) => other.url === link['url'])) continue
    links.push({ url: link['url'], text: link['text'].slice(0, MAX_LINK_TEXT) })
    if (links.length >= MAX_LINKS) break
  }
  return links
}

export function register(_ctx: MainContext): void {
  let prefetchSession: Session | null = null
  const fetcher: Fetcher = (url, init) => {
    prefetchSession ??= session.fromPartition(PREFETCH_PARTITION, { cache: false })
    return prefetchSession.fetch(url, init)
  }

  // Only the /link-summaries skill runs this (summarize_links is never offered to the model).
  provideLinkSummaries({
    async summarize(signal = new AbortController().signal): Promise<LinkSummary[]> {
      const contents = getPage()?.contents()
      if (!contents || contents.isDestroyed()) throw new Error('No page is loaded.')
      const links = parseLinks(
        await contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [
          { code: scriptSource(collectLinks, { maxLinks: MAX_LINKS, maxText: MAX_LINK_TEXT }) },
        ]),
      )
      if (links === null) throw new Error('This page’s links couldn’t be read.')
      if (links.length === 0) throw new Error('No links to summarise in this page’s text.')
      const pages = await mapLimit(links, PARALLEL_FETCHES, async ({ url }) => {
        const html = await prefetchHtml(fetcher, url, {
          timeoutMs: FETCH_TIMEOUT_MS,
          maxBytes: MAX_BYTES,
          signal,
        })
        return html === null ? null : { url, ...extractPage(html, MAX_PAGE_TEXT) }
      })
      signal.throwIfAborted()
      const sources = pages.filter(
        (page): page is SummarySource => page !== null && Boolean(page.text || page.description),
      )
      if (sources.length === 0) throw new Error('None of the linked pages could be read.')
      const answer = await complete({
        system: LINK_SUMMARY_SYSTEM,
        text: linkSummaryPrompt(sources),
        signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
      })
      const summaries = parseLinkSummaries(answer.text, sources.length)
      return links.map(({ url, text }, index) => {
        const page = pages[index]
        const source = page ? sources.indexOf(page as SummarySource) : -1
        return {
          url,
          label: text || page?.title || url,
          host: new URL(url).host,
          summary: source === -1 ? null : (summaries.get(source + 1) ?? null),
        }
      })
    },
  })
}
