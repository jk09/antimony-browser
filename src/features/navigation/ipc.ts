export const channels = {
  go: 'navigation:go',
  // A command from the application menu, not a state change.
  openLocation: 'navigation:open-location',
} as const

export interface NavigationApi {
  /** Loads `url` in the page view. Main rejects anything `toUrl` doesn't accept. */
  go(url: string): Promise<void>
  /** Called when the user picks File → Open Location…. Returns an unsubscribe function. */
  onOpenLocation(listener: () => void): () => void
}
