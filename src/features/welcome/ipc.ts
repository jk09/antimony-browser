export const channels = {
  state: 'welcome:state',
  setDone: 'welcome:set-done',
  // /welcome: the UI asks main to open the page (main relays it, as File → Welcome does).
  requestOpen: 'welcome:request-open',
  // main → UI: show the welcome page (no payload).
  open: 'welcome:open',
} as const

export interface WelcomeState {
  /** The user finished or closed the welcome page once; it no longer opens at startup. */
  done: boolean
}

export interface WelcomeApi {
  state(): Promise<WelcomeState>
  setDone(done: boolean): Promise<WelcomeState>
  /** Opens the welcome page (/welcome); main answers with an `open` event. */
  requestOpen(): Promise<void>
  onOpen(listener: () => void): () => void
}
