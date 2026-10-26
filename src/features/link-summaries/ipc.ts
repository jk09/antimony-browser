export const channels = {
  settings: 'link-summaries:settings',
  updateSettings: 'link-summaries:update-settings',
  // Main → UI.
  settingsChanged: 'link-summaries:settings-changed',
} as const

export interface LinkSummariesSettings {
  /** Summary tooltips on the links of simple pages. Off by default. */
  enabled: boolean
}

export interface LinkSummariesApi {
  settings(): Promise<LinkSummariesSettings>
  updateSettings(update: Partial<LinkSummariesSettings>): Promise<LinkSummariesSettings>
  /** Called when the mode is switched (also from File → Link Summaries). Returns an unsubscribe function. */
  onSettingsChanged(listener: (settings: LinkSummariesSettings) => void): () => void
}
