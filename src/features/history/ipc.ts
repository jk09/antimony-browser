export const channels = {
  suggest: 'history:suggest',
  search: 'history:search',
  screenshot: 'history:screenshot',
  current: 'history:current',
  setNote: 'history:set-note',
  delete: 'history:delete',
  clear: 'history:clear',
  settings: 'history:settings',
  updateSettings: 'history:update-settings',
  requestOpen: 'history:request-open',
  // Main → UI.
  open: 'history:open',
  changed: 'history:pages-changed',
  settingsChanged: 'history:settings-changed',
} as const

/** A visit lasting this long (active time) makes a page worth a screenshot and a summary. */
export const HIGH_DWELL_MS = 30_000
export const MAX_NOTE = 4000
export const MAX_QUERY = 500

export type SearchMode = 'text' | 'semantic'

export interface SearchRequest {
  /** '' lists the most recent pages. */
  query: string
  mode: SearchMode
  /** Only pages with a note. */
  bookmarked: boolean
}

/** A page in history, as the UI sees it (no visible text, no screenshot bytes). */
export interface HistoryPage {
  id: number
  url: string
  title: string
  description: string | null
  /** Epoch milliseconds. */
  lastVisitAt: number
  visitCount: number
  /** Total active time on the page, milliseconds. */
  dwellMs: number
  note: string | null
  summary: string | null
  hasScreenshot: boolean
  /** Excerpt around the match, matched words wrapped in SNIPPET_START / SNIPPET_END. */
  snippet?: string
}

export const SNIPPET_START = '\u0002'
export const SNIPPET_END = '\u0003'

export interface SearchResult {
  pages: HistoryPage[]
  /** Why the results aren't what was asked for (e.g. semantic search fell back to text). */
  notice?: string
}

/** A visited page for the prompt's URL suggestions. */
export interface VisitedSuggestion {
  url: string
  title: string
}

export interface HistorySettings {
  /** Summarise pages with high dwell time with the selected model (sends page content to it). */
  summaries: boolean
}

export interface OpenRequest {
  query?: string
  /** Show the note editor for the current page. */
  note?: boolean
}

export interface HistoryApi {
  /** Visited pages whose URL (without scheme and www.) or domain starts with `text`. */
  suggest(text: string): Promise<VisitedSuggestion[]>
  search(request: SearchRequest): Promise<SearchResult>
  /** The page's screenshot as a `data:image/jpeg` URL, or null. */
  screenshot(id: number): Promise<string | null>
  /** The page shown in the page view, if history recorded it. */
  current(): Promise<HistoryPage | null>
  /** Sets (or with null / '' removes) the note of a page; a page with a note is a bookmark. */
  setNote(id: number, note: string | null): Promise<void>
  delete(id: number): Promise<void>
  /** Removes history; noted pages keep their URL, title and note unless `all`. */
  clear(all: boolean): Promise<void>
  settings(): Promise<HistorySettings>
  updateSettings(update: Partial<HistorySettings>): Promise<HistorySettings>
  /** Opens the history view (from a /command); main answers with an `open` event. */
  requestOpen(request: OpenRequest): Promise<void>
  onOpen(listener: (request: OpenRequest) => void): () => void
  /** History changed in a way an open view should show (note, delete, clear). */
  onChanged(listener: () => void): () => void
  onSettingsChanged(listener: (settings: HistorySettings) => void): () => void
}
