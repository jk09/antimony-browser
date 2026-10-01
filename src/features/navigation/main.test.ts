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
  navigationHistory = {
    canGoBack: () => true,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn(),
  }
  isDestroyed = () => false
  getURL = () => 'https://example.com/'
  getTitle = () => 'Example'
  isLoading = () => this.loading
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
  static last: FakeView
  webContents = new FakeWebContents()
  setBounds = vi.fn()
  constructor(public options: unknown) {
    FakeView.last = this
  }
}

vi.mock('electron', () => ({ app: {}, WebContentsView: FakeView }))

const { register, getPage, onPageEvent } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const windowListeners = new Map<string, Listener>()
  let size = [1000, 700]
  let zoom = 1
  const ctx = {
    window: {
      getContentSize: () => size,
      contentView: { addChildView: vi.fn() },
      webContents: { focus: vi.fn(), getZoomFactor: () => zoom },
      on: (event: string, listener: Listener) => windowListeners.set(event, listener),
    },
    browsingSession: { name: 'browsing' },
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
    fileMenu: [] as MenuItemConstructorOptions[],
  }
  register(ctx as unknown as MainContext)
  const page = FakeView.last
  return {
    ctx,
    page,
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

  it('opens new-window links in the page view and never creates a window', () => {
    const { page } = setup()
    const open = page.webContents.windowOpenHandler!
    const referrer = { url: 'https://example.com/', policy: 'strict-origin-when-cross-origin' }
    expect(open({ url: 'https://example.org/a', referrer })).toEqual({ action: 'deny' })
    const postBody = { data: [], contentType: 'application/x-www-form-urlencoded' }
    expect(open({ url: 'https://example.org/form', referrer, postBody })).toEqual({
      action: 'deny',
    })
    for (const url of ['about:blank', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(open({ url, referrer }), url).toEqual({ action: 'deny' })
    }
    expect(page.webContents.loadURL.mock.calls).toEqual([
      ['https://example.org/a', { httpReferrer: referrer }],
      [
        'https://example.org/form',
        {
          httpReferrer: referrer,
          postData: [],
          extraHeaders: 'Content-Type: application/x-www-form-urlencoded',
        },
      ],
    ])
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

    go('example.com')
    fire('did-navigate', 'https://example.com/', 200)
    fire('did-navigate', 'https://example.com/next', 200)
    getPage()!.back()
    fire('did-navigate', 'https://example.com/', 200)
    getPage()!.reload()
    fire('did-navigate', 'https://example.com/', 200)
    getPage()!.load('example.org')
    fire('did-fail-load', -105, 'NAME_NOT_RESOLVED', 'https://example.org/', true)
    fire('did-navigate', 'https://example.com/clicked', 404)
    fire('page-title-updated', 'Clicked')
    fire('did-stop-loading')
    unsubscribe()
    fire('did-navigate', 'https://example.com/ignored', 200)

    expect(events).toEqual([
      { type: 'navigated', url: 'https://example.com/', status: 200, transition: 'typed' },
      { type: 'navigated', url: 'https://example.com/next', status: 200, transition: 'link' },
      { type: 'navigated', url: 'https://example.com/', status: 200, transition: 'back_forward' },
      { type: 'navigated', url: 'https://example.com/', status: 200, transition: 'reload' },
      { type: 'navigated', url: 'https://example.com/clicked', status: 404, transition: 'link' },
      { type: 'title', title: 'Clicked' },
      { type: 'loaded', url: 'https://example.com/' },
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

    fire('did-navigate-in-page', 'https://example.com/#a', true)
    fire('input-event', { type: 'mouseWheel' })
    fire('did-navigate-in-page', 'https://example.com/?page=2', true)
    fire('input-event', { type: 'mouseDown' })
    vi.advanceTimersByTime(1500)
    fire('did-navigate-in-page', 'https://example.com/item/1', true)
    fire('did-navigate-in-page', 'https://ads.example/frame', false)
    unsubscribe()
    vi.useRealTimers()

    expect(events).toEqual([
      { type: 'navigated-in-page', url: 'https://example.com/#a', sinceInputMs: null },
      { type: 'navigated-in-page', url: 'https://example.com/?page=2', sinceInputMs: null },
      { type: 'navigated-in-page', url: 'https://example.com/item/1', sinceInputMs: 1500 },
    ])
  })
})
