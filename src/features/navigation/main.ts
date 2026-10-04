import { WebContentsView, type WebContents } from 'electron'
import type { MainContext } from '../../app/main/features'
import { secureWebPreferences } from '../../app/main/security'
import { channels, type NavigationState, type PageInsets } from './ipc'
import { isWebUrl, toUrl } from './shared/to-url'

const MAX_INSET = 4000

/** Controls for the active tab's page, for other features' main code (the agent, history). */
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
  /**
   * Hides or shows the active tab's page view without changing its size, so another feature can
   * draw over the page area (prompt's field of view). Stays in force across tab switches.
   */
  setHidden(hidden: boolean): void
  /** The active tab's WebContents, or null without a tab, before its first load, or after it's gone. */
  contents(): WebContents | null
}

/** The tabs, for other features' main code (stacks). Ids are positive integers. */
export interface TabControls {
  /** The active tab's id, or null with no tab. */
  active(): number | null
  ids(): number[]
  /** Creates a tab, loading `url` (checked with `toUrl`) if given; returns its id. */
  create(options: { url?: string; activate: boolean; transition?: Transition }): number
  /** Shows the tab in the page area (null: no tab, the placeholder shows). Unknown ids are ignored. */
  activate(id: number | null): void
  /** Closes the tab and destroys its page. Closing the active tab leaves no active tab. */
  close(id: number): void
  /** Loads a URL in a tab; false if the tab or the URL is invalid. */
  load(id: number, url: string, transition: Transition): boolean
  /** The tab's session history (Chromium's linear back/forward list), or null for an unknown tab. */
  entries(id: number): { urls: string[]; index: number } | null
  /** Goes to an entry of the tab's session history, reported with transition back_forward. */
  goToIndex(id: number, index: number): void
  /**
   * Creates a tab in the background that loads `url` (checked with `toUrl`), sized to the page
   * area. Its page events are held until it is first activated, then emitted in order after
   * `activated`, so nothing records it before it's shown. Returns its id, or null for a bad URL.
   */
  prepare(url: string): number | null
  /** How a prepared tab's load went; null once it was activated, or for an unknown tab. */
  prepared(id: number): 'loading' | 'loaded' | 'failed' | null
  /** Gives the tab's page keyboard focus. Unknown ids are ignored. */
  focus(id: number): void
  /** Whether the tab's page plays sound and whether it is muted; null for an unknown tab. */
  audio(id: number): TabAudio | null
  /** Mutes or unmutes the tab's page; reported as an `audio` event. Unknown ids are ignored. */
  setMuted(id: number, muted: boolean): void
}

/** A tab's sound: `audible` is Chromium's view (it lags a couple of seconds behind silence). */
export interface TabAudio {
  audible: boolean
  muted: boolean
}

/**
 * Decides what back and forward mean (stacks: parent and last visited child in the tree).
 * `back`/`forward` return false when they don't handle the tab; Chromium's history is used then.
 */
export interface HistoryResolver {
  back(tabId: number): boolean
  forward(tabId: number): boolean
  canGoBack(tabId: number): boolean
  canGoForward(tabId: number): boolean
}

let controls: PageControls | null = null
let tabControls: TabControls | null = null
let resolver: HistoryResolver | null = null

/** How a navigation of a tab started; history stores it with the visit. */
export type Transition = 'typed' | 'link' | 'back_forward' | 'assistant' | 'reload'

/**
 * How a navigation changed the tab's session history: a new entry, the current one replaced
 * (reload, replaceState, redirect to the same entry), or a move back or forward.
 */
export type EntryChange = 'new' | 'replaced' | 'back' | 'forward'

/** What happens in a tab's main frame, for other features' main code (history, stacks). */
export type PageEvent = { tabId: number } & (
  | /** A navigation committed (redirects already followed). `status` is the HTTP status, or ≤ 0. */
    {
      type: 'navigated'
      url: string
      status: number
      transition: Transition
      entry: EntryChange
    }
    /**
     * pushState, replaceState or a fragment change. `sinceInputMs`: time since the user (or the
     * assistant) last clicked, tapped or pressed a key in the page or went back/forward; null if never.
     */
  | { type: 'navigated-in-page'; url: string; sinceInputMs: number | null; entry: EntryChange }
  /** A main-frame load failed or was aborted before it committed. */
  | { type: 'failed' }
  | { type: 'title'; title: string }
  | { type: 'loaded'; url: string }
  /** The page asked for a new window; the tab was created for it (`active`: it was shown). */
  | { type: 'opened'; openerId: number; active: boolean }
  /** The tab became the active one ('' before its first page). */
  | { type: 'activated'; url: string }
  /** The tab started or stopped playing sound, or was muted or unmuted. */
  | ({ type: 'audio' } & TabAudio)
)

type Distribute<T> = T extends unknown ? Omit<T, 'tabId'> : never
type TabEvent = Distribute<PageEvent>

const pageListeners = new Set<(event: PageEvent) => void>()

/** Subscribes to the tabs' events; returns an unsubscribe function. */
export function onPageEvent(listener: (event: PageEvent) => void): () => void {
  pageListeners.add(listener)
  return () => pageListeners.delete(listener)
}

function emit(event: PageEvent) {
  for (const listener of pageListeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('Page event listener failed', error)
    }
  }
}

/** The active tab's page controls; null until navigation is registered. */
export function getPage(): PageControls | null {
  return controls
}

/** The tab controls; null until navigation is registered. */
export function getTabs(): TabControls | null {
  return tabControls
}

/** Lets another feature decide what back and forward mean; null restores Chromium's history. */
export function setHistoryResolver(value: HistoryResolver | null): void {
  resolver = value
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

interface Tab {
  id: number
  view: WebContentsView
  contents: WebContents
  /** Set when a navigation is started here, read when it commits; anything else is a link. */
  pending: Transition | null
  /** Last click, tap or key press in the page. Scrolling and mouse moves don't count. */
  lastInputAt: number | null
  /** Session history index after the last reported navigation. */
  index: number
  /** A page was loaded: the view covers the page area while the tab is active. */
  hasPage: boolean
  /** Prepared and not yet activated: its events wait here (`prepare`). */
  held: TabEvent[] | null
  /** A prepared tab's load: failed stays failed (also when its renderer goes away). */
  preparedState: 'loading' | 'loaded' | 'failed'
}

const empty: NavigationState = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
}

export function register({ window, browsingSession, ipc }: MainContext): void {
  const tabs = new Map<number, Tab>()
  let nextId = 1
  let active: Tab | null = null
  /** The tab whose view is in the window. */
  let attached: Tab | null = null
  /** The page view is in the window but not drawn (`setHidden`). */
  let hidden = false

  // The chrome UI reports the page area's insets when it mounts, before a page can be loaded.
  // They're in its CSS pixels: times its zoom factor, they're window pixels.
  let insets: PageInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  const bounds = () => {
    const [width = 0, height = 0] = window.getContentSize()
    const zoom = window.webContents.getZoomFactor()
    const [top, right, bottom, left] = [insets.top, insets.right, insets.bottom, insets.left].map(
      (inset) => Math.round(inset * zoom),
    ) as [number, number, number, number]
    return {
      x: left,
      y: top,
      width: Math.max(0, width - left - right),
      height: Math.max(0, height - top - bottom),
    }
  }
  /** Sizes the shown view and the prepared ones, so they don't reflow when shown. */
  const layout = () => {
    const prepared = [...tabs.values()].filter((tab) => tab.held && tab !== attached)
    if (!attached && prepared.length === 0) return
    const box = bounds()
    attached?.view.setBounds(box)
    for (const tab of prepared) tab.view.setBounds(box)
  }
  window.on('resize', layout)

  /** Puts the active tab's view in the window if it has a page; the placeholder shows otherwise. */
  const attach = () => {
    const wanted = active?.hasPage ? active : null
    if (attached === wanted) return
    if (attached) window.contentView.removeChildView(attached.view)
    attached = wanted
    if (attached) {
      window.contentView.addChildView(attached.view)
      attached.view.setVisible(!hidden)
      layout()
    }
  }

  const live = (tab: Tab | null): tab is Tab =>
    tab !== null && tab.hasPage && !tab.contents.isDestroyed()

  const state = (): NavigationState => {
    const tab = active
    if (!live(tab)) return empty
    const history = tab.contents.navigationHistory
    return {
      url: tab.contents.getURL(),
      title: tab.contents.getTitle(),
      loading: tab.contents.isLoading(),
      canGoBack: resolver ? resolver.canGoBack(tab.id) : history.canGoBack(),
      canGoForward: resolver ? resolver.canGoForward(tab.id) : history.canGoForward(),
    }
  }
  const publish = () => ipc.send(channels.stateChanged, state())

  const load = (tab: Tab, url: string, options?: Electron.LoadURLOptions) => {
    tab.hasPage = true
    if (tab === active) attach()
    tab.contents.loadURL(url, options).catch((error: unknown) => {
      console.warn(`Failed to load ${url}`, error)
    })
  }

  const open = (tab: Tab, input: string, transition: Transition) => {
    const url = toUrl(input)
    if (url === null) return null
    tab.pending = transition
    load(tab, url)
    return url
  }

  const activate = (tab: Tab | null) => {
    if (active === tab) return
    active = tab
    attach()
    if (tab) emit({ tabId: tab.id, type: 'activated', url: live(tab) ? tab.contents.getURL() : '' })
    // A prepared tab is shown: what happened in it in the background is reported now.
    if (tab?.held) {
      const held = tab.held
      tab.held = null
      for (const event of held) emit({ ...event, tabId: tab.id } as PageEvent)
    }
    publish()
  }

  const createTab = (): Tab => {
    const view = new WebContentsView({
      webPreferences: { ...secureWebPreferences, session: browsingSession },
    })
    const contents = view.webContents
    const tab: Tab = {
      id: nextId++,
      view,
      contents,
      pending: null,
      lastInputAt: null,
      index: -1,
      hasPage: false,
      held: null,
      preparedState: 'loading',
    }
    tabs.set(tab.id, tab)
    const send = (event: TabEvent) => {
      if (!tab.held) return emit({ ...event, tabId: tab.id } as PageEvent)
      tab.held.push(event)
      if (event.type === 'failed') tab.preparedState = 'failed'
      else if (event.type === 'loaded' && tab.preparedState === 'loading') {
        tab.preparedState = 'loaded'
      }
    }
    contents.on('render-process-gone', () => {
      tab.preparedState = 'failed'
    })
    const publishIfActive = () => {
      if (tab === active) publish()
    }

    const guard = (event: Electron.Event<{ url: string }>) => {
      if (!isWebUrl(event.url)) event.preventDefault()
    }
    contents.on('will-navigate', guard)
    contents.on('will-redirect', guard)
    contents.on('input-event', (_event, input) => {
      if (['mouseDown', 'rawKeyDown', 'keyDown', 'gestureTap'].includes(input.type)) {
        tab.lastInputAt = Date.now()
      }
    })

    // Links that ask for a new window (target=_blank, window.open, Ctrl/middle-click) open a tab.
    contents.setWindowOpenHandler(({ url, referrer, postBody, disposition }) => {
      if (isWebUrl(url)) {
        const opened = createTab()
        opened.pending = 'link'
        const show = disposition !== 'background-tab'
        emit({ tabId: opened.id, type: 'opened', openerId: tab.id, active: show })
        load(opened, url, {
          httpReferrer: referrer,
          ...(postBody && {
            postData: postBody.data,
            extraHeaders: `Content-Type: ${postBody.contentType}`,
          }),
        })
        if (show) activate(opened)
      }
      return { action: 'deny' }
    })

    /** How the session history changed since the last navigation reported. */
    const entryChange = (): EntryChange => {
      const history = contents.navigationHistory
      const index = history.getActiveIndex()
      const previous = tab.index
      tab.index = index
      if (index < previous) return 'back'
      if (index === previous) return 'replaced'
      return tab.pending === 'back_forward' ? 'forward' : 'new'
    }

    contents.on('did-navigate', (_event, url: string, status: number) => {
      const entry = entryChange()
      const moved = entry === 'back' || entry === 'forward'
      const transition = tab.pending ?? (moved ? 'back_forward' : 'link')
      tab.pending = null
      send({ type: 'navigated', url, status, transition, entry })
      publishIfActive()
    })
    contents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame: boolean) => {
      if (!isMainFrame) return
      tab.pending = null
      send({ type: 'failed' })
    })
    contents.on('did-navigate-in-page', (_event, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      const entry = entryChange()
      // Back/forward between entries of the same document doesn't commit a new navigation.
      if (tab.pending === 'back_forward') {
        tab.pending = null
        tab.lastInputAt = Date.now()
      }
      send({
        type: 'navigated-in-page',
        url,
        sinceInputMs: tab.lastInputAt === null ? null : Date.now() - tab.lastInputAt,
        entry,
      })
      publishIfActive()
    })
    contents.on('page-title-updated', (_event, title: string) => {
      send({ type: 'title', title })
      publishIfActive()
    })
    contents.on('audio-state-changed', ({ audible }) => {
      send({ type: 'audio', audible, muted: contents.isAudioMuted() })
    })
    contents.on('did-start-loading', publishIfActive)
    contents.on('did-stop-loading', () => {
      send({ type: 'loaded', url: contents.getURL() })
      publishIfActive()
    })
    return tab
  }

  const closeTab = (tab: Tab) => {
    if (active === tab) {
      active = null
      attach()
      publish()
    }
    tabs.delete(tab.id)
    if (!tab.contents.isDestroyed()) {
      ;(tab.contents as WebContents & { close?: () => void }).close?.()
    }
  }

  const ensureActive = (): Tab => {
    if (active) return active
    const tab = createTab()
    activate(tab)
    return tab
  }

  const onActive = (action: (tab: Tab) => void) => () => {
    if (live(active)) action(active)
  }

  const goBack = onActive((tab) => {
    if (resolver?.back(tab.id)) return
    tab.pending = 'back_forward'
    tab.contents.navigationHistory.goBack()
  })
  const goForward = onActive((tab) => {
    if (resolver?.forward(tab.id)) return
    tab.pending = 'back_forward'
    tab.contents.navigationHistory.goForward()
  })

  const pageControls: PageControls = {
    load: (input) => open(ensureActive(), input, 'assistant'),
    back: goBack,
    forward: goForward,
    reload: onActive((tab) => {
      tab.pending = 'reload'
      tab.contents.reload()
    }),
    stop: onActive((tab) => tab.contents.stop()),
    state,
    waitForLoad(timeoutMs) {
      const tab = active
      if (!live(tab) || !tab.contents.isLoading()) return Promise.resolve()
      const contents = tab.contents
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
    setHidden(value) {
      hidden = value
      attached?.view.setVisible(!hidden)
    },
    contents: () => (live(active) ? active.contents : null),
  }
  controls = pageControls

  // Mouse back/forward buttons (Windows reports them as app commands).
  window.on('app-command', (_event, command: string) => {
    if (command === 'browser-backward') goBack()
    else if (command === 'browser-forward') goForward()
  })

  tabControls = {
    active: () => active?.id ?? null,
    ids: () => [...tabs.keys()],
    create({ url, activate: show, transition = 'typed' }) {
      const tab = createTab()
      if (url !== undefined) open(tab, url, transition)
      if (show) activate(tab)
      return tab.id
    },
    activate: (id) => {
      if (id === null) activate(null)
      else {
        const tab = tabs.get(id)
        if (tab) activate(tab)
      }
    },
    close: (id) => {
      const tab = tabs.get(id)
      if (tab) closeTab(tab)
    },
    load(id, url, transition) {
      const tab = tabs.get(id)
      return tab !== undefined && open(tab, url, transition) !== null
    },
    entries(id) {
      const tab = tabs.get(id)
      if (!live(tab ?? null)) return tab ? { urls: [], index: -1 } : null
      const history = tab!.contents.navigationHistory
      return { urls: history.getAllEntries().map((e) => e.url), index: history.getActiveIndex() }
    },
    goToIndex(id, index) {
      const tab = tabs.get(id)
      if (!live(tab ?? null)) return
      tab!.pending = 'back_forward'
      tab!.contents.navigationHistory.goToIndex(index)
    },
    prepare(input) {
      const url = toUrl(input)
      if (url === null) return null
      const tab = createTab()
      tab.held = []
      tab.view.setBounds(bounds())
      open(tab, url, 'typed')
      return tab.id
    },
    prepared(id) {
      const tab = tabs.get(id)
      return tab?.held ? tab.preparedState : null
    },
    focus(id) {
      const tab = tabs.get(id)
      if (tab && !tab.contents.isDestroyed()) tab.contents.focus()
    },
    audio(id) {
      const tab = tabs.get(id)
      if (!tab) return null
      if (tab.contents.isDestroyed()) return { audible: false, muted: false }
      return { audible: tab.contents.isCurrentlyAudible(), muted: tab.contents.isAudioMuted() }
    },
    setMuted(id, muted) {
      const tab = tabs.get(id)
      if (!tab || tab.contents.isDestroyed() || tab.contents.isAudioMuted() === muted) return
      tab.contents.setAudioMuted(muted)
      emit({ tabId: id, type: 'audio', audible: tab.contents.isCurrentlyAudible(), muted })
    },
  }

  ipc.handle(channels.go, (input) => {
    const url = typeof input === 'string' ? toUrl(input) : null
    if (url === null) throw new TypeError(`${channels.go} expects an http(s) URL`)
    const tab = ensureActive()
    open(tab, url, 'typed')
    tab.contents.focus()
  })
  ipc.handle(channels.back, () => pageControls.back())
  ipc.handle(channels.forward, () => pageControls.forward())
  ipc.handle(channels.reload, () => pageControls.reload())
  ipc.handle(channels.stop, () => pageControls.stop())
  ipc.handle(channels.setInsets, (value) => {
    insets = parseInsets(value)
    layout()
  })
}
