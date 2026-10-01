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

const { register, getPage } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const windowListeners = new Map<string, Listener>()
  let size = [1000, 700]
  const ctx = {
    window: {
      getContentSize: () => size,
      contentView: { addChildView: vi.fn() },
      webContents: { focus: vi.fn() },
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
})
