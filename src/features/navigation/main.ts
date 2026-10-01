import { WebContentsView, type WebContents } from 'electron'
import type { MainContext } from '../../app/main/features'
import { secureWebPreferences } from '../../app/main/security'
import { channels, type NavigationState, type PageInsets } from './ipc'
import { isWebUrl, toUrl } from './shared/to-url'

const MAX_INSET = 4000

/** Controls for the page view, for other features' main code (the agent). */
export interface PageControls {
  /** Loads typed text or a URL if `toUrl` accepts it; returns the URL, or null (nothing loaded). */
  load(input: string): string | null
  back(): void
  forward(): void
  reload(): void
  stop(): void
  state(): NavigationState
  /** Resolves when the page stops loading, or after `timeoutMs`. */
  waitForLoad(timeoutMs: number): Promise<void>
  /** The page's WebContents, or null before the first page is loaded or after it's gone. */
  contents(): WebContents | null
}

let controls: PageControls | null = null

/** The page view's controls; null until navigation is registered. */
export function getPage(): PageControls | null {
  return controls
}

function parseInsets(value: unknown): PageInsets {
  const sides = ['top', 'right', 'bottom', 'left'] as const
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${channels.setInsets} expects { top, right, bottom, left }`)
  }
  const record = value as Record<string, unknown>
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const side of sides) {
    const n = record[side]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_INSET) {
      throw new TypeError(`${channels.setInsets}: ${side} must be a number from 0 to ${MAX_INSET}`)
    }
    insets[side] = Math.round(n)
  }
  return insets
}

export function register({ window, browsingSession, ipc }: MainContext): void {
  const page = new WebContentsView({
    webPreferences: { ...secureWebPreferences, session: browsingSession },
  })
  const contents = page.webContents
  const guard = (event: Electron.Event<{ url: string }>) => {
    if (!isWebUrl(event.url)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)

  const load = (url: string, options?: Electron.LoadURLOptions) => {
    contents.loadURL(url, options).catch((error: unknown) => {
      console.warn(`Failed to load ${url}`, error)
    })
  }

  // No tabs yet: links that ask for a new window (target=_blank, window.open) open in this page.
  contents.setWindowOpenHandler(({ url, referrer, postBody }) => {
    if (isWebUrl(url)) {
      load(url, {
        httpReferrer: referrer,
        ...(postBody && {
          postData: postBody.data,
          extraHeaders: `Content-Type: ${postBody.contentType}`,
        }),
      })
    }
    return { action: 'deny' }
  })

  // The chrome UI reports the page area's insets when it mounts, before a page can be loaded.
  let insets: PageInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  const layout = () => {
    const [width = 0, height = 0] = window.getContentSize()
    page.setBounds({
      x: insets.left,
      y: insets.top,
      width: Math.max(0, width - insets.left - insets.right),
      height: Math.max(0, height - insets.top - insets.bottom),
    })
  }

  // The placeholder in the chrome UI stays visible until the first page is loaded.
  let shown = false
  const show = () => {
    if (shown) return
    shown = true
    window.contentView.addChildView(page)
    layout()
    window.on('resize', layout)
  }

  const state = (): NavigationState => {
    if (!shown || contents.isDestroyed()) {
      return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false }
    }
    return {
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    }
  }
  const publish = () => ipc.send(channels.stateChanged, state())
  contents.on('did-navigate', publish)
  contents.on('did-navigate-in-page', publish)
  contents.on('page-title-updated', publish)
  contents.on('did-start-loading', publish)
  contents.on('did-stop-loading', publish)

  const whenShown = (action: () => void) => () => {
    if (shown && !contents.isDestroyed()) action()
  }

  const pageControls: PageControls = {
    load(input) {
      const url = toUrl(input)
      if (url === null) return null
      show()
      load(url)
      return url
    },
    back: whenShown(() => contents.navigationHistory.goBack()),
    forward: whenShown(() => contents.navigationHistory.goForward()),
    reload: whenShown(() => contents.reload()),
    stop: whenShown(() => contents.stop()),
    state,
    waitForLoad(timeoutMs) {
      if (!shown || contents.isDestroyed() || !contents.isLoading()) return Promise.resolve()
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer)
          contents.off('did-stop-loading', done)
          resolve()
        }
        const timer = setTimeout(done, timeoutMs)
        contents.on('did-stop-loading', done)
      })
    },
    contents: () => (shown && !contents.isDestroyed() ? contents : null),
  }
  controls = pageControls

  ipc.handle(channels.go, (input) => {
    const url = typeof input === 'string' ? toUrl(input) : null
    if (url === null) throw new TypeError(`${channels.go} expects an http(s) URL`)
    pageControls.load(url)
    contents.focus()
  })
  ipc.handle(channels.back, () => pageControls.back())
  ipc.handle(channels.forward, () => pageControls.forward())
  ipc.handle(channels.reload, () => pageControls.reload())
  ipc.handle(channels.stop, () => pageControls.stop())
  ipc.handle(channels.setInsets, (value) => {
    insets = parseInsets(value)
    if (shown) layout()
  })
}
