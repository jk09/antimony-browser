// Groups imported visits into browsing sessions. Pure: no electron, Node or React imports.
import type { ImportRow } from './edge-csv'

/** Visits more than this far apart belong to different sessions. */
export const SESSION_GAP_MS = 30 * 60_000

/** One page of a session: its first address and title, and when it was first and last visited there. */
export interface SessionPage {
  url: string
  title: string
  firstAt: number
  lastAt: number
}

/** Pages visited together, in the order they were first visited. */
export interface ImportSession {
  pages: SessionPage[]
  startedAt: number
  endedAt: number
}

const withoutFragment = (url: string) => url.replace(/#.*$/, '')

/**
 * Splits visits into sessions at gaps over `gapMs`, oldest first. A page visited again in its
 * session (same address ignoring the fragment) stays one page; a title fills an empty one.
 */
export function groupSessions(rows: ImportRow[], gapMs: number = SESSION_GAP_MS): ImportSession[] {
  const sorted = [...rows].sort((a, b) => a.at - b.at)
  const sessions: ImportSession[] = []
  let known = new Map<string, SessionPage>()
  for (const row of sorted) {
    let session = sessions[sessions.length - 1]
    if (!session || row.at - session.endedAt > gapMs) {
      session = { pages: [], startedAt: row.at, endedAt: row.at }
      sessions.push(session)
      known = new Map()
    }
    session.endedAt = row.at
    const id = withoutFragment(row.url)
    const page = known.get(id)
    if (page) {
      page.lastAt = row.at
      if (page.title === '') page.title = row.title
    } else {
      const created = { url: row.url, title: row.title, firstAt: row.at, lastAt: row.at }
      known.set(id, created)
      session.pages.push(created)
    }
  }
  return sessions
}
