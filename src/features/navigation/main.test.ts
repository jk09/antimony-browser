import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

type Listener = (...args: unknown[]) => void

class FakeWebContents {
  listeners = new Map<string, Listener>()
  loadURL = vi.fn((_url: string, _options?: unknown) => Promise.resolve())
  focus = vi.fn()
  reload = vi.fn()
  stop = vi.fn()
  loading = false
  index = -1
  urls: string[] = []
  navigationHistory = {
    canGoBack: () => true,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn(),
    goToIndex: vi.fn(),
    getActiveIndex: () => this.index,
    getAllEntries: () => this.urls.map((url) => ({ url, title: '' })),
  }
  close = vi.fn()
  isDestroyed = () => false
  getURL = () => 'https://example.com/'
  getTitle = () => 'Example'
  isLoading = () => this.loading
  audible = false
  muted = false
  isCurrentlyAudible = () => this.audible
  isAudioMuted = () => this.muted
  setAudioMuted = vi.fn((muted: boolean) => {
    this.muted = muted
  })
  off(event: string) {
    this.listeners.delete(event)
    return this
  }
  windowOpenHandler?: (details: unknown) => unknown
  setWindowOpenHandler(handler: (details: unknown) => unknown) {
    this.windowOpenHandler = handler
  }
  on(event: string, listener: Listener) {
    this.listeners.set(event, listener)
    return this
  }
}

class FakeView {
  static all: FakeView[] = []
  static get last() {
    return FakeView.all.at(-1)!
  }
  webContents = new FakeWebContents()
  setBounds = vi.fn()
  setVisible = vi.fn()
  constructor(public options: unknown) {
    FakeView.all.push(this)
  }
}

vi.mock('electron', () => ({ app: {}, WebContentsView: FakeView }))

const { register, getPage, getTabs, onPageEvent, setHistoryResolver } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const windowListeners = new Map<string, Listener>()
  let size = [1000, 700]
  let zoom = 1
  const ctx = {
    window: {
      getContentSize: () => size,
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      webContents: { focus: vi.fn(), getZoomFactor: () => zoom },
      on: (event: string, listener: Listener) => windowListeners.set(event, listener),
      emit: (event: string, ...args: unknown[]) => windowListeners.get(event)!(...args),
    },
    browsingSession: { name: 'browsing' },
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
    fileMenu: [] as MenuItemConstructorOptions[],
  }
  FakeView.all = []
  setHistoryResolver(null)
  register(ctx as unknown as MainContext)
  // The first tab is created on the first load; tests that need it before call `tab()`.
  const tab = () => FakeView.all[0] ?? (getTabs()!.create({ activate: true }), FakeView.all[0]!)
  return {
    tab,
    get page() {
      return tab()
    },
    ctx,
    go: (...args: unknown[]) => handlers.get(channels.go)!(...args),
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
    resize: (width: number, height: number) => {
      size = [width, height]
      windowListeners.get('resize')!()
    },
    setZoom: (factor: number) => {
      zoom = factor
    },
  }
}

describe('navigation main', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the page view on the browsing session without a preload', () => {
    const { page } = setup()
    const { webPreferences } = page.options as { webPreferences: Record<string, unknown> }
    expect(webPreferences).toMatchObject({ sandbox: true, contextIsolation: true })
    expect(webPreferences['session']).toEqual({ name: 'browsing' })
    expect(webPreferences['preload']).toBeUndefined()
  })

  it('rejects invalid arguments to navigation:go', () => {
    const { go, page, ctx } = setup()
    for (const input of [
      undefined,
      42,
      { url: 'https://example.com' },
      '',
      'javascript:alert(1)',
    ]) {
      expect(() => go(input), String(input)).toThrow(TypeError)
    }
    expect(page.webContents.loadURL).not.toHaveBeenCalled()
    expect(ctx.window.contentView.addChildView).not.toHaveBeenCalled()
  })

  it('loads valid URLs, focuses the page and adds its view once, with no insets yet', () => {
    const { go, page, ctx } = setup()
    go('example.com')
    go('https://example.org/')
    expect(page.webContents.loadURL.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/',
      'https://example.org/',
    ])
    expect(page.webContents.focus).toHaveBeenCalled()
    expect(ctx.window.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(page.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
    })
  })

  it('resizes the page view with the window', () => {
    const { go, page, resize } = setup()
    go('example.com')
    resize(800, 500)
    expect(page.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 800,
      height: 500,
    })
  })

  it('hides and shows the page view without resizing it, and keeps it hidden across tab switches', () => {
    const { go, page, tab } = setup()
    go('example.com')
    page.setBounds.mockClear()
    getPage()!.setHidden(true)
    expect(page.setVisible).toHaveBeenLastCalledWith(false)
    expect(page.setBounds).not.toHaveBeenCalled()
    const other = getTabs()!.create({ url: 'https://example.org/', activate: true })
    expect(other).not.toBe(getTabs()!.ids()[0])
    expect(FakeView.last.setVisible).toHaveBeenLastCalledWith(false)
    getPage()!.setHidden(false)
    expect(FakeView.last.setVisible).toHaveBeenLastCalledWith(true)
    expect(tab()).toBe(page)
  })

  it('blocks page navigations to non-web URLs', () => {
    const { page } = setup()
    for (const event of ['will-navigate', 'will-redirect']) {
      const guard = page.webContents.listeners.get(event)!
      const blocked = { url: 'file:///etc/passwd', preventDefault: vi.fn() }
      const allowed = { url: 'https://example.com/', preventDefault: vi.fn() }
      guard(blocked)
      guard(allowed)
      expect(blocked.preventDefault, event).toHaveBeenCalled()
      expect(allowed.preventDefault, event).not.toHaveBeenCalled()
    }
  })

  it('opens new-window links in a new tab and never creates a window', () => {
    const { page, go, ctx } = setup()
    go('example.com')
    const events: unknown[] = []
    const unsubscribe = onPageEvent((event) => events.push(event))
    const open = page.webContents.windowOpenHandler!
    const referrer = { url: 'https://example.com/', policy: 'strict-origin-when-cross-origin' }
    expect(open({ url: 'https://example.org/a', referrer, disposition: 'foreground-tab' })).toEqual(
      { action: 'deny' },
    )
    const postBody = { data: [], contentType: 'application/x-www-form-urlencoded' }
    expect(
      open({ url: 'https://example.org/form', referrer, postBody, disposition: 'background-tab' }),
    ).toEqual({ action: 'deny' })
    for (const url of ['about:blank', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(open({ url, referrer, disposition: 'foreground-tab' }), url).toEqual({
        action: 'deny',
      })
    }
    unsubscribe()
    expect(FakeView.all).toHaveLength(3)
    const [, foreground, background] = FakeView.all as [FakeView, FakeView, FakeView]
    expect(foreground.webContents.loadURL.mock.calls).toEqual([
      ['https://example.org/a', { httpReferrer: referrer }],
    ])
    expect(background.webContents.loadURL.mock.calls).toEqual([
      [
        'https://example.org/form',
        {
          httpReferrer: referrer,
          postData: [],
          extraHeaders: 'Content-Type: application/x-www-form-urlencoded',
        },
      ],
    ])
    // Every tab has the same secure web preferences on the browsing session.
    for (const view of FakeView.all) {
      expect(view.options).toEqual(page.options)
    }
    // The foreground tab replaced the first one in the window; the background one wasn't shown.
    expect(ctx.window.contentView.removeChildView).toHaveBeenCalledWith(page)
    expect(ctx.window.contentView.addChildView).toHaveBeenLastCalledWith(foreground)
    expect(getTabs()!.active()).toBe(2)
    expect(events).toEqual([
      { tabId: 2, type: 'opened', openerId: 1, active: true },
      { tabId: 2, type: 'activated', url: 'https://example.com/' },
      { tabId: 3, type: 'opened', openerId: 1, active: false },
    ])
  })

  it('switches, loads and closes tabs', () => {
    const { go, page, ctx } = setup()
    go('example.com')
    const tabs = getTabs()!
    const second = tabs.create({ activate: false, url: 'example.org' })
    expect(tabs.ids()).toEqual([1, second])
    expect(tabs.active()).toBe(1)
    tabs.activate(second)
    expect(ctx.window.contentView.addChildView).toHaveBeenLastCalledWith(FakeView.all[1])
    expect(getPage()!.contents()).toBe(FakeView.all[1]!.webContents)
    expect(tabs.load(second, 'javascript:alert(1)', 'typed')).toBe(false)
    expect(tabs.load(99, 'example.net', 'typed')).toBe(false)
    expect(tabs.load(second, 'example.net', 'back_forward')).toBe(true)
    tabs.close(second)
    expect(FakeView.all[1]!.webContents.close).toHaveBeenCalled()
    expect(tabs.active()).toBeNull()
    expect(getPage()!.contents()).toBeNull()
    expect(ctx.ipc.send).toHaveBeenLastCalledWith(channels.stateChanged, {
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })
    tabs.activate(1)
    expect(getPage()!.contents()).toBe(page.webContents)
    page.webContents.urls = ['https://example.com/a', 'https://example.com/b']
    page.webContents.index = 1
    expect(tabs.entries(1)).toEqual({ urls: page.webContents.urls, index: 1 })
    tabs.goToIndex(1, 0)
    expect(page.webContents.navigationHistory.goToIndex).toHaveBeenCalledWith(0)
  })

  it('reports and mutes each tab’s sound', () => {
    const { tab } = setup()
    const page = tab()
    const tabs = getTabs()!
    const id = tabs.active()!
    const events: unknown[] = []
    const unsubscribe = onPageEvent((event) => events.push(event))
    expect(tabs.audio(id)).toEqual({ audible: false, muted: false })
    expect(tabs.audio(999)).toBeNull()

    page.webContents.audible = true
    page.webContents.listeners.get('audio-state-changed')!({ audible: true })
    expect(events).toEqual([{ tabId: id, type: 'audio', audible: true, muted: false }])
    expect(tabs.audio(id)).toEqual({ audible: true, muted: false })

    tabs.setMuted(id, true)
    expect(page.webContents.setAudioMuted).toHaveBeenCalledWith(true)
    expect(events.at(-1)).toEqual({ tabId: id, type: 'audio', audible: true, muted: true })
    expect(tabs.audio(id)).toEqual({ audible: true, muted: true })
    // Unchanged or unknown: nothing happens.
    tabs.setMuted(id, true)
    tabs.setMuted(999, false)
    expect(page.webContents.setAudioMuted).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(2)
    unsubscribe()
  })

  it('prepares a tab in the background, sized to the page area, holding its events until shown', () => {
    const { tab, call, ctx, resize } = setup()
    tab()
    call(channels.setInsets, { top: 10, right: 300, bottom: 0, left: 0 })
    const tabs = getTabs()!
    expect(tabs.prepare('javascript:alert(1)')).toBeNull()
    const id = tabs.prepare('start.example')!
    const spare = FakeView.last
    expect(spare.webContents.loadURL).toHaveBeenCalledWith('https://start.example/', undefined)
    expect(spare.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 10, width: 700, height: 690 })
    expect(ctx.window.contentView.addChildView).not.toHaveBeenCalled()
    resize(1200, 800)
    expect(spare.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 10, width: 900, height: 790 })

    const events: unknown[] = []
    const unsubscribe = onPageEvent((event) => events.push(event))
    const fire = (name: string, ...args: unknown[]) =>
      spare.webContents.listeners.get(name)!({}, ...args)
    spare.webContents.index = 0
    fire('did-navigate', 'https://start.example/', 200)
    fire('page-title-updated', 'Start')
    expect(tabs.prepared(id)).toBe('loading')
    fire('did-stop-loading')
    expect(tabs.prepared(id)).toBe('loaded')
    expect(events).toEqual([])

    tabs.activate(id)
    expect(ctx.window.contentView.addChildView).toHaveBeenCalledWith(spare)
    expect(events).toEqual([
      { tabId: id, type: 'activated', url: 'https://example.com/' },
      {
        tabId: id,
        type: 'navigated',
        url: 'https://start.example/',
        status: 200,
        transition: 'typed',
        entry: 'new',
      },
      { tabId: id, type: 'title', title: 'Start' },
      { tabId: id, type: 'loaded', url: 'https://example.com/' },
    ])
    expect(tabs.prepared(id)).toBeNull()
    // Shown, it reports as it goes.
    fire('page-title-updated', 'Later')
    expect(events.at(-1)).toEqual({ tabId: id, type: 'title', title: 'Later' })
    tabs.focus(id)
    expect(spare.webContents.focus).toHaveBeenCalled()
    unsubscribe()
  })

  it('marks a prepared tab failed when its load fails or its renderer goes away', () => {
    setup()
    const tabs = getTabs()!
    const failed = tabs.prepare('start.example')!
    FakeView.last.webContents.listeners.get('did-fail-load')!({}, -2, 'failed', '', true)
    FakeView.last.webContents.listeners.get('did-stop-loading')!()
    expect(tabs.prepared(failed)).toBe('failed')
    const gone = tabs.prepare('start.example')!
    FakeView.last.webContents.listeners.get('render-process-gone')!({}, { reason: 'crashed' })
    expect(tabs.prepared(gone)).toBe('failed')
    expect(tabs.prepared(999)).toBeNull()
  })

  it('lets a history resolver decide what back and forward mean', () => {
    const { go, page, ctx } = setup()
    go('example.com')
    const resolver = {
      back: vi.fn(() => true),
      forward: vi.fn(() => false),
      canGoBack: () => false,
      canGoForward: () => true,
    }
    setHistoryResolver(resolver)
    ctx.window.emit('app-command', {}, 'browser-backward')
    ctx.window.emit('app-command', {}, 'browser-forward')
    expect(resolver.back).toHaveBeenCalledWith(1)
    expect(page.webContents.navigationHistory.goBack).not.toHaveBeenCalled()
    expect(page.webContents.navigationHistory.goForward).toHaveBeenCalled()
    page.webContents.listeners.get('page-title-updated')!()
    expect(ctx.ipc.send).toHaveBeenLastCalledWith(
      channels.stateChanged,
      expect.objectContaining({ canGoBack: false, canGoForward: true }),
    )
  })

  it('lays the page view out inside the insets the chrome UI reports', () => {
    const { go, page, call, resize } = setup()
    go('example.com')
    call(channels.setInsets, { top: 120, right: 420, bottom: 2, left: 2 })
    expect(page.setBounds).toHaveBeenLastCalledWith({ x: 2, y: 120, width: 578, height: 578 })
    resize(1200, 800)
    expect(page.setBounds).toHaveBeenLastCalledWith({ x: 2, y: 120, width: 778, height: 678 })
  })

  it('scales the insets by the chrome UI zoom, so the page view meets a zoomed panel', () => {
    const { go, page, call, setZoom } = setup()
    go('example.com')
    setZoom(0.5)
    call(channels.setInsets, { top: 0, right: 400, bottom: 0, left: 0 })
    expect(page.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 800, height: 700 })
    setZoom(1.25)
    call(channels.setInsets, { top: 0, right: 400, bottom: 0, left: 3 })
    expect(page.setBounds).toHaveBeenLastCalledWith({ x: 4, y: 0, width: 496, height: 700 })
  })

  it('rejects invalid insets', () => {
    const { call } = setup()
    for (const insets of [
      null,
      { top: 1, right: 0, bottom: 0 },
      { top: -1, right: 0, bottom: 0, left: 0 },
      { top: 5000, right: 0, bottom: 0, left: 0 },
      { top: '1', right: 0, bottom: 0, left: 0 },
    ]) {
      expect(() => call(channels.setInsets, insets), JSON.stringify(insets)).toThrow(TypeError)
    }
  })

  it('reports page state to the chrome UI and does nothing before a page is loaded', () => {
    const { go, page, ctx, call } = setup()
    call(channels.back)
    expect(page.webContents.navigationHistory.goBack).not.toHaveBeenCalled()
    expect(getPage()!.state()).toEqual({
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })
    go('example.com')
    page.webContents.listeners.get('page-title-updated')!()
    expect(ctx.ipc.send).toHaveBeenLastCalledWith(channels.stateChanged, {
      url: 'https://example.com/',
      title: 'Example',
      loading: false,
      canGoBack: true,
      canGoForward: false,
    })
    call(channels.back)
    call(channels.reload)
    expect(page.webContents.navigationHistory.goBack).toHaveBeenCalled()
    expect(page.webContents.reload).toHaveBeenCalled()
  })

  it('exports page controls that only load web addresses', () => {
    const { page } = setup()
    const controls = getPage()!
    expect(controls.contents()).toBeNull()
    expect(controls.load('javascript:alert(1)')).toBeNull()
    expect(controls.load('example.org')).toBe('https://example.org/')
    expect(page.webContents.loadURL).toHaveBeenCalledWith('https://example.org/', undefined)
    expect(controls.contents()).toBe(page.webContents)
  })

  it('waits for the page to stop loading, or for the timeout', async () => {
    vi.useFakeTimers()
    try {
      const { page } = setup()
      const controls = getPage()!
      controls.load('example.com')
      page.webContents.loading = true
      let done = false
      void controls.waitForLoad(5000).then(() => (done = true))
      await vi.advanceTimersByTimeAsync(100)
      expect(done).toBe(false)
      page.webContents.listeners.get('did-stop-loading')!()
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toBe(true)

      let timedOut = false
      void controls.waitForLoad(5000).then(() => (timedOut = true))
      await vi.advanceTimersByTimeAsync(5000)
      expect(timedOut).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells other features how each navigation started', () => {
    const { go, page } = setup()
    const events: unknown[] = []
    const unsubscribe = onPageEvent((event) => events.push(event))
    const fire = (name: string, ...args: unknown[]) =>
      page.webContents.listeners.get(name)!({}, ...args)

    const contents = page.webContents
    go('example.com')
    contents.index = 0
    fire('did-navigate', 'https://example.com/', 200)
    contents.index = 1
    fire('did-navigate', 'https://example.com/next', 200)
    getPage()!.back()
    contents.index = 0
    fire('did-navigate', 'https://example.com/', 200)
    getPage()!.reload()
    fire('did-navigate', 'https://example.com/', 200)
    getPage()!.load('example.org')
    fire('did-fail-load', -105, 'NAME_NOT_RESOLVED', 'https://example.org/', true)
    contents.index = 1
    fire('did-navigate', 'https://example.com/clicked', 404)
    // history.back() from the page script: no pending transition, but the index went back.
    contents.index = 0
    fire('did-navigate', 'https://example.com/', 200)
    fire('page-title-updated', 'Clicked')
    fire('did-stop-loading')
    unsubscribe()
    fire('did-navigate', 'https://example.com/ignored', 200)

    const nav = (url: string, status: number, transition: string, entry: string) => ({
      tabId: 1,
      type: 'navigated',
      url,
      status,
      transition,
      entry,
    })
    expect(events).toEqual([
      nav('https://example.com/', 200, 'typed', 'new'),
      nav('https://example.com/next', 200, 'link', 'new'),
      nav('https://example.com/', 200, 'back_forward', 'back'),
      nav('https://example.com/', 200, 'reload', 'replaced'),
      { tabId: 1, type: 'failed' },
      nav('https://example.com/clicked', 404, 'link', 'new'),
      nav('https://example.com/', 200, 'back_forward', 'back'),
      { tabId: 1, type: 'title', title: 'Clicked' },
      { tabId: 1, type: 'loaded', url: 'https://example.com/' },
    ])
  })

  it('reports in-page navigations of the main frame with the time since user input', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const { go, page } = setup()
    const events: unknown[] = []
    const unsubscribe = onPageEvent((event) => events.push(event))
    const fire = (name: string, ...args: unknown[]) =>
      page.webContents.listeners.get(name)!({}, ...args)
    go('example.com')

    page.webContents.index = 0
    fire('did-navigate-in-page', 'https://example.com/#a', true)
    fire('input-event', { type: 'mouseWheel' })
    fire('did-navigate-in-page', 'https://example.com/?page=2', true)
    page.webContents.index = 1
    fire('input-event', { type: 'mouseDown' })
    vi.advanceTimersByTime(1500)
    fire('did-navigate-in-page', 'https://example.com/item/1', true)
    fire('did-navigate-in-page', 'https://ads.example/frame', false)
    unsubscribe()
    vi.useRealTimers()

    expect(events).toEqual([
      {
        tabId: 1,
        type: 'navigated-in-page',
        url: 'https://example.com/#a',
        sinceInputMs: null,
        entry: 'new',
      },
      {
        tabId: 1,
        type: 'navigated-in-page',
        url: 'https://example.com/?page=2',
        sinceInputMs: null,
        entry: 'replaced',
      },
      {
        tabId: 1,
        type: 'navigated-in-page',
        url: 'https://example.com/item/1',
        sinceInputMs: 1500,
        entry: 'new',
      },
    ])
  })
})
