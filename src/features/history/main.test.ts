import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'
import type { HistoryPort } from '../agent/main'
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
  nativeImage: {
    createFromBuffer: (buffer: Buffer) => ({
      isEmpty: () => buffer.length === 0,
      getSize: () => ({ width: 800, height: 500 }),
      resize: ({ width }: { width: number }) => ({
        toJPEG: () => Buffer.from(`small-${width}-${buffer.toString('hex')}`),
      }),
    }),
  },
}))

const complete = vi.fn()
let historySearch: HistoryPort | null = null
vi.mock('../agent/main', () => ({
  complete: (...args: unknown[]) => complete(...args),
  provideHistorySearch: (port: HistoryPort) => {
    historySearch = port
  },
}))

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
  getTabs: () => ({ active: () => 1 }),
  onPageEvent: (listener: (event: PageEvent) => void) => {
    pageListener = listener
    return () => {}
  },
}))

const { register, parseOpen, parseRecallRequest, parseSearch } = await import('./main')
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
  /** An event of the active tab (1); navigations add a session history entry. */
  type Raw<T> = T extends unknown ? Omit<T, 'tabId' | 'entry'> & { tabId?: number } : never
  const page = (event: Raw<PageEvent>) =>
    pageListener!({
      tabId: 1,
      ...(event.type.startsWith('navigated') && { entry: 'new' }),
      ...event,
    } as PageEvent)
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
      [channels.recall, { query: '', sketch: null }],
      [channels.recall, { query: 'x'.repeat(501), sketch: null }],
      [channels.recall, { query: 'a', sketch: 'data:image/png;base64,AAAA' }],
      [channels.recall, { query: 'a', sketch: 'data:image/jpeg;base64,<script>' }],
      [channels.recall, { query: 'a', sketch: `data:image/jpeg;base64,${'A'.repeat(1_000_000)}` }],
      [channels.recall, { query: 'a', sketch: null, view: 'words' }],
      [channels.recall, 'lions'],
      [channels.requestRecall, 42],
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
    expect(
      parseRecallRequest({ query: ' lions ', sketch: 'data:image/jpeg;base64,/9j/AA==' }),
    ).toEqual({ query: 'lions', sketch: 'data:image/jpeg;base64,/9j/AA==' })
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

  it('records only the active tab, and a switch of tabs as a back/forward visit', async () => {
    const { call, page } = setup()
    page({ type: 'navigated', url: 'https://example.com/a', status: 200, transition: 'link' })
    page({
      tabId: 2,
      type: 'navigated',
      url: 'https://example.com/background',
      status: 200,
      transition: 'link',
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(call(channels.current)).toMatchObject({ url: 'https://example.com/a' })
    page({ tabId: 2, type: 'activated', url: 'https://example.com/background' })
    await vi.advanceTimersByTimeAsync(1500)
    expect(call(channels.current)).toMatchObject({ url: 'https://example.com/background' })
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

  it("gives the assistant's search_history the same text and meaning search", async () => {
    const { call, page } = setup()
    page({ type: 'navigated', url: 'https://example.com/a', status: 200, transition: 'link' })
    page({ type: 'loaded', url: 'https://example.com/a' })
    await vi.advanceTimersByTimeAsync(1500)
    const a = call(channels.current) as { id: number }
    call(channels.setNote, a.id, 'vector database pricing')
    page({ type: 'navigated', url: 'https://example.com/b', status: 200, transition: 'link' })
    const b = call(channels.current) as { id: number }

    const text = await historySearch!.search('readers', 'text', false)
    expect(text.pages).toEqual([
      {
        title: 'Write-ahead logging',
        url: 'https://example.com/a',
        lastVisitAt: expect.any(Number),
        visitCount: 1,
        note: 'vector database pricing',
        description: 'How WAL works',
        summary: null,
        snippet: expect.stringContaining('«Readers»'),
      },
    ])
    expect(complete).not.toHaveBeenCalled()

    complete.mockResolvedValue({ text: `[${b.id}, ${a.id}]`, model: 'm' })
    const meaning = await historySearch!.search('databases', 'meaning', true)
    expect(meaning.pages.map((p) => p.url)).toEqual(['https://example.com/a'])
    expect((complete.mock.calls[0]![0] as { text: string }).text).toContain('Request: databases')

    complete.mockRejectedValue(new Error('No Anthropic API key is set.'))
    const fallback = await historySearch!.search('vector', 'meaning', false)
    expect(fallback.pages.map((p) => p.url)).toEqual(['https://example.com/a'])
    expect(fallback.notice).toMatch(/No Anthropic API key/)
  })

  it('recalls pages with keywords, and sends screenshots only with a sketch', async () => {
    const { call, page } = setup()
    page({ type: 'navigated', url: 'https://example.com/lions', status: 200, transition: 'link' })
    await vi.advanceTimersByTimeAsync(HIGH_DWELL_MS + 5000)
    const lions = call(channels.current) as { id: number }
    call(channels.setNote, lions.id, 'lions on the savanna')
    page({ type: 'navigated', url: 'https://example.com/tax', status: 200, transition: 'link' })
    const tax = call(channels.current) as { id: number }
    call(channels.setNote, tax.id, 'tax forms')

    complete.mockResolvedValue({
      text: JSON.stringify({
        view: 'words',
        pages: [{ id: lions.id, score: 0.9, keywords: ['Lions', 'savanna'] }],
      }),
      model: 'm',
    })
    const result = (await call(channels.recall, {
      query: 'show all pages about lions',
      sketch: null,
    })) as {
      view: string
      pages: { id: number; score: number; keywords: string[] }[]
      keywords: unknown[]
    }
    expect(result).toEqual({
      view: 'words',
      pages: [
        expect.objectContaining({ id: lions.id, score: 0.9, keywords: ['lions', 'savanna'] }),
      ],
      keywords: [
        { text: 'lions', weight: 0.9, pageIds: [lions.id] },
        { text: 'savanna', weight: 0.9, pageIds: [lions.id] },
      ],
    })
    const [request] = complete.mock.calls[0]! as [{ text: string; images?: unknown[] }]
    expect(request.text).toContain('<untrusted_history>')
    expect(request.text).toContain('Request: show all pages about lions')
    expect(request.images).toBeUndefined()

    // A sketch: the sketch first, then the screenshots of candidates that have one, scaled down.
    complete.mockResolvedValue({ text: '{"view":"images","pages":[]}', model: 'm' })
    const sketched = (await call(channels.recall, {
      query: '',
      sketch: 'data:image/jpeg;base64,/9j/SKETCH',
    })) as { view: string; pages: unknown[] }
    expect(sketched).toEqual({ view: 'images', pages: [], keywords: [] })
    const [withSketch] = complete.mock.calls[1]! as [
      { text: string; images: { label: string; jpegBase64: string }[] },
    ]
    expect(withSketch.text).toContain('The first image is the sketch')
    expect(withSketch.images).toEqual([
      { label: 'Sketch:', jpegBase64: '/9j/SKETCH' },
      {
        label: `Screenshot of page ${lions.id}:`,
        jpegBase64: Buffer.from('small-320-ffd801').toString('base64'),
      },
    ])
  })

  it('falls back to text matches with title keywords when the model fails', async () => {
    const { call, page } = setup()
    pageMeta = meta({ title: 'Lions of the Serengeti', text: 'Lions hunt at dusk.' })
    page({ type: 'navigated', url: 'https://example.com/lions', status: 200, transition: 'link' })
    page({ type: 'loaded', url: 'https://example.com/lions' })
    await vi.advanceTimersByTimeAsync(1500)

    complete.mockRejectedValue(new Error('No Anthropic API key is set.'))
    const result = (await call(channels.recall, { query: 'lions', sketch: null })) as {
      pages: { url: string }[]
      keywords: { text: string }[]
      notice: string
    }
    expect(result.pages.map((p) => p.url)).toEqual(['https://example.com/lions'])
    expect(result.keywords.map((k) => k.text)).toEqual(['lions', 'serengeti'])
    expect(result.notice).toMatch(/No Anthropic API key.*text matches/)

    call(channels.setNote, (call(channels.current) as { id: number }).id, 'big cats')
    const sketchOnly = (await call(channels.recall, {
      query: '',
      sketch: 'data:image/jpeg;base64,/9j/',
    })) as { pages: unknown[]; notice: string }
    expect(sketchOnly.pages).toEqual([])
    expect(sketchOnly.notice).toMatch(/Recall failed \(No Anthropic API key/)
  })

  it('cancels a recall in flight, answering it with nothing', async () => {
    const { call, page } = setup()
    page({ type: 'navigated', url: 'https://example.com/a', status: 200, transition: 'link' })
    const a = call(channels.current) as { id: number }
    call(channels.setNote, a.id, 'lions')
    complete.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    )
    const pending = call(channels.recall, { query: 'lions', sketch: null }) as Promise<unknown>
    call(channels.cancelRecall)
    expect(await pending).toEqual({ view: 'words', pages: [], keywords: [] })
  })

  it('adds File → Recall from History… (Ctrl/Cmd+Shift+Y) and opens Recall from /recall', () => {
    const { ctx, call } = setup()
    const item = ctx.fileMenu.find((entry) => entry.id === 'recall')!
    expect(item).toMatchObject({ label: 'Recall from History…', accelerator: 'CmdOrCtrl+Shift+Y' })
    ;(item.click as () => void)()
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.openRecall, '')
    call(channels.requestRecall, 'lions')
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.openRecall, 'lions')
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
