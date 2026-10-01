import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'
import type { PageEvent } from '../navigation/main'
import type { PageMeta } from './shared/page-meta'

let userData = ''
const quitHandlers: (() => void)[] = []
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: (event: string, handler: () => void) => {
      if (event === 'will-quit') quitHandlers.push(handler)
    },
  },
  powerMonitor: { getSystemIdleTime: () => 0, on: vi.fn() },
}))

const complete = vi.fn()
vi.mock('../agent/main', () => ({ complete: (...args: unknown[]) => complete(...args) }))

let pageListener: ((event: PageEvent) => void) | null = null
let pageMeta: PageMeta
const pageContents = {
  executeJavaScriptInIsolatedWorld: vi.fn(async () => pageMeta),
  capturePage: vi.fn(async () => ({
    isEmpty: () => false,
    getSize: () => ({ width: 1600, height: 1000 }),
    resize: () => ({ toJPEG: () => Buffer.from([0xff, 0xd8, 0x01]) }),
    toJPEG: () => Buffer.from([0xff, 0xd8, 0x02]),
  })),
}
vi.mock('../navigation/main', () => ({
  getPage: () => ({ contents: () => pageContents }),
  onPageEvent: (listener: (event: PageEvent) => void) => {
    pageListener = listener
    return () => {}
  },
}))

const { register, parseOpen, parseSearch } = await import('./main')
const { channels, HIGH_DWELL_MS } = await import('./ipc')

const meta = (overrides: Partial<PageMeta> = {}): PageMeta => ({
  title: 'Write-ahead logging',
  description: 'How WAL works',
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
  text: 'Readers do not block writers.',
  sensitive: false,
  ...overrides,
})

function setup() {
  userData = mkdtempSync(join(tmpdir(), 'antimony-history-'))
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    window: {
      on: vi.fn(),
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => true,
      webContents: { focus: vi.fn() },
    },
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
    fileMenu: [] as MenuItemConstructorOptions[],
  }
  register(ctx as unknown as MainContext)
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  const page = (event: PageEvent) => pageListener!(event)
  return { ctx, call, page }
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 1, 12) })
  pageMeta = meta()
  complete.mockReset()
  pageContents.capturePage.mockClear()
  pageContents.executeJavaScriptInIsolatedWorld.mockClear()
})
afterEach(() => {
  for (const handler of quitHandlers.splice(0)) handler()
  vi.useRealTimers()
})

describe('history main', () => {
  it('rejects malformed arguments', () => {
    const { call } = setup()
    const bad: [string, ...unknown[]][] = [
      [channels.suggest, 42],
      [channels.suggest, 'x'.repeat(501)],
      [channels.search, { query: 'a', mode: 'fuzzy', bookmarked: false }],
      [channels.search, { query: 1, mode: 'text', bookmarked: false }],
      [channels.search, 'a'],
      [channels.screenshot, '1'],
      [channels.screenshot, 1.5],
      [channels.screenshot, -1],
      [channels.setNote, 1, 42],
      [channels.setNote, 1, 'x'.repeat(4001)],
      [channels.delete, null],
      [channels.clear, 'all'],
      [channels.updateSettings, { summaries: 'yes' }],
      [channels.updateSettings, { other: true }],
      [channels.requestOpen, { query: 1 }],
      [channels.requestOpen, { path: '/etc' }],
    ]
    for (const [channel, ...args] of bad) {
      expect(() => call(channel, ...args), `${channel} ${JSON.stringify(args)}`).toThrow(TypeError)
    }
    expect(parseSearch({ query: '', mode: 'semantic', bookmarked: true })).toEqual({
      query: '',
      mode: 'semantic',
      bookmarked: true,
    })
    expect(parseOpen(undefined)).toEqual({})
  })

  it('records visits from page events and serves suggestions, search and the current page', async () => {
    const { call, page } = setup()
    page({
      type: 'navigated',
      url: 'https://www.example.com/wal?utm_source=x',
      status: 200,
      transition: 'typed',
    })
    page({ type: 'title', title: 'WAL' })
    page({ type: 'loaded', url: 'https://www.example.com/wal' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(call(channels.suggest, 'exam')).toEqual([
      { url: 'https://www.example.com/wal', title: 'Write-ahead logging' },
    ])
    const found = (await call(channels.search, {
      query: 'readers',
      mode: 'text',
      bookmarked: false,
    })) as { pages: { url: string; snippet?: string }[] }
    expect(found.pages.map((p) => p.url)).toEqual(['https://www.example.com/wal'])
    expect(call(channels.current)).toMatchObject({ url: 'https://www.example.com/wal' })
  })

  it('notes, deletes and clears pages, telling an open view', async () => {
    const { call, page, ctx } = setup()
    page({ type: 'navigated', url: 'https://example.com/a', status: 200, transition: 'link' })
    const { id } = call(channels.current) as { id: number }
    call(channels.setNote, id, 'Compare with Postgres')
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.changed, null)
    const bookmarks = (await call(channels.search, {
      query: '',
      mode: 'text',
      bookmarked: true,
    })) as { pages: { note: string }[] }
    expect(bookmarks.pages.map((p) => p.note)).toEqual(['Compare with Postgres'])

    call(channels.clear, false)
    expect(call(channels.suggest, 'example')).toHaveLength(1)
    call(channels.clear, true)
    expect(call(channels.suggest, 'example')).toEqual([])
    expect(() => call(channels.setNote, id, 'gone')).toThrow(/no longer in history/)

    page({ type: 'navigated', url: 'https://example.com/b', status: 200, transition: 'link' })
    const b = call(channels.current) as { id: number }
    call(channels.delete, b.id)
    expect(call(channels.current)).toBeNull()
  })

  it('captures a screenshot after high dwell, and summarises only when enabled', async () => {
    const { call, page } = setup()
    page({ type: 'navigated', url: 'https://example.com/wal', status: 200, transition: 'link' })
    await vi.advanceTimersByTimeAsync(HIGH_DWELL_MS - 5000)
    expect(pageContents.capturePage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    const { id } = call(channels.current) as { id: number }
    expect(call(channels.screenshot, id)).toBe(
      `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0x01]).toString('base64')}`,
    )
    expect(complete).not.toHaveBeenCalled()

    call(channels.updateSettings, { summaries: true })
    complete.mockResolvedValue({ text: 'SUMMARY: About WAL.\nLOOKS: A diagram.', model: 'm' })
    page({ type: 'navigated', url: 'https://example.com/other', status: 200, transition: 'link' })
    await vi.advanceTimersByTimeAsync(HIGH_DWELL_MS + 5000)
    expect(complete).toHaveBeenCalledTimes(1)
    const [request] = complete.mock.calls[0]! as [{ text: string; imageJpegBase64: string }]
    expect(request.text).toContain('<untrusted_page_content>')
    expect(request.text).toContain('Readers do not block writers.')
    expect(request.imageJpegBase64).toBe(Buffer.from([0xff, 0xd8, 0x01]).toString('base64'))
    const found = (await call(channels.search, {
      query: 'diagram',
      mode: 'text',
      bookmarked: false,
    })) as { pages: { url: string; summary: string }[] }
    expect(found.pages).toEqual([
      expect.objectContaining({ url: 'https://example.com/other', summary: 'About WAL.' }),
    ])
  })

  it('keeps no screenshot and asks no model for pages with sensitive fields', async () => {
    const { call, page } = setup()
    call(channels.updateSettings, { summaries: true })
    pageMeta = meta({ sensitive: true, text: '' })
    page({ type: 'navigated', url: 'https://bank.example/', status: 200, transition: 'link' })
    await vi.advanceTimersByTimeAsync(HIGH_DWELL_MS + 5000)
    expect(pageContents.capturePage).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('applies a same-page rel=canonical', async () => {
    const { call, page } = setup()
    pageMeta = meta({ canonicalLink: '/a?id=1' })
    page({
      type: 'navigated',
      url: 'https://example.com/a?id=1&sid=xyz',
      status: 200,
      transition: 'link',
    })
    page({ type: 'loaded', url: 'https://example.com/a?id=1&sid=xyz' })
    await vi.advanceTimersByTimeAsync(1500)
    expect(call(channels.current)).toMatchObject({ url: 'https://example.com/a?id=1' })
    expect(call(channels.suggest, 'example.com/a')).toHaveLength(1)
  })

  it('ranks by meaning with the model, and falls back to text matches', async () => {
    const { call, page } = setup()
    page({ type: 'navigated', url: 'https://example.com/a', status: 200, transition: 'link' })
    const a = call(channels.current) as { id: number }
    call(channels.setNote, a.id, 'vector database pricing')
    page({ type: 'navigated', url: 'https://example.com/b', status: 200, transition: 'link' })
    const b = call(channels.current) as { id: number }
    call(channels.setNote, b.id, 'cat pictures')

    complete.mockResolvedValue({ text: `[${b.id}, 12345]`, model: 'm' })
    const ranked = (await call(channels.search, {
      query: 'kittens',
      mode: 'semantic',
      bookmarked: false,
    })) as { pages: { id: number }[]; notice?: string }
    expect(ranked).toEqual({ pages: [expect.objectContaining({ id: b.id })] })
    const [request] = complete.mock.calls[0]! as [{ text: string }]
    expect(request.text).toContain('vector database pricing')
    expect(request.text).toContain('Request: kittens')

    complete.mockRejectedValue(new Error('No Anthropic API key is set.'))
    const fallback = (await call(channels.search, {
      query: 'vector',
      mode: 'semantic',
      bookmarked: false,
    })) as { pages: { id: number }[]; notice?: string }
    expect(fallback.pages.map((p) => p.id)).toEqual([a.id])
    expect(fallback.notice).toMatch(/No Anthropic API key/)
  })

  it('adds File → Note This Page… (Ctrl/Cmd+D), which opens the note editor', () => {
    const { ctx, call } = setup()
    const item = ctx.fileMenu.find((entry) => entry.id === 'note-page')!
    expect(item).toMatchObject({ label: 'Note This Page…', accelerator: 'CmdOrCtrl+D' })
    ;(item.click as () => void)()
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.open, { note: true })
    call(channels.requestOpen, { query: 'wal' })
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.open, { query: 'wal' })
  })
})
