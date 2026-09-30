export const channels = {
  go: 'navigation:go',
  back: 'navigation:back',
  forward: 'navigation:forward',
  reload: 'navigation:reload',
  stop: 'navigation:stop',
  setInsets: 'navigation:set-insets',
  stateChanged: 'navigation:state-changed',
} as const

export interface NavigationState {
  /** '' until the first page is loaded. */
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** Space the chrome UI covers on each side of the window, in CSS pixels; the page gets the rest. */
export interface PageInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface NavigationApi {
  /** Loads `url` in the page view. Main rejects anything `toUrl` doesn't accept. */
  go(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  stop(): Promise<void>
  /** Lays the page view out inside the window minus `insets`. */
  setInsets(insets: PageInsets): Promise<void>
  /** Called after navigations, title changes and loading changes. Returns an unsubscribe function. */
  onStateChanged(listener: (state: NavigationState) => void): () => void
  /** Typed text → http(s) URL, or null if it isn't a web address (runs in the preload, no IPC). */
  toUrl(input: string): string | null
}
