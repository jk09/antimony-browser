import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

type Listener = (...args: unknown[]) => void

class FakeWebContents {
  listeners = new Map<string, Listener>()
  loadURL = vi.fn(() => Promise.resolve())
  focus = vi.fn()
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

const { register, TOOLBAR_HEIGHT } = await import('./main')
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

  it('loads valid URLs and adds the page view once, below the toolbar', () => {
    const { go, page, ctx } = setup()
    go('example.com')
    go('https://example.org/')
    expect(page.webContents.loadURL.mock.calls).toEqual([
      ['https://example.com/'],
      ['https://example.org/'],
    ])
    expect(page.webContents.focus).toHaveBeenCalled()
    expect(ctx.window.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(page.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width: 1000,
      height: 700 - TOOLBAR_HEIGHT,
    })
  })

  it('resizes the page view with the window', () => {
    const { go, page, resize } = setup()
    go('example.com')
    resize(800, 500)
    expect(page.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width: 800,
      height: 500 - TOOLBAR_HEIGHT,
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

  it('adds File → Open Location…, which focuses the chrome UI and asks it for a URL', () => {
    const { ctx } = setup()
    const [item] = ctx.fileMenu
    expect(item).toMatchObject({ label: 'Open Location…', accelerator: 'CmdOrCtrl+L' })
    ;(item!.click as () => void)()
    expect(ctx.window.webContents.focus).toHaveBeenCalled()
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.openLocation, null)
  })
})
