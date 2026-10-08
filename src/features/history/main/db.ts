// The history database: one row per canonical URL in `pages`, one row per visit in `visits`, and
// an FTS5 index over the page's words. node:sqlite is built into Electron's Node (no native module).
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { HIGH_DWELL_MS, type HistoryPage, type VisitedSuggestion } from '../ipc'
import { bareInput, bareUrl, domainOf, hostOf } from '../shared/canonical-url'
import type { PageMeta } from '../shared/page-meta'
import type { Follow, MapRow } from './map'

export type Transition = 'typed' | 'link' | 'back_forward' | 'assistant' | 'reload' | 'in_page'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const SCHEMA_VERSION = 1

// Columns of pages_fts, in order, with their bm25 weights.
const ftsColumns = [
  ['title', 10],
  ['url', 3],
  ['description', 4],
  ['keywords', 2],
  ['text', 1],
  ['summary', 5],
  ['visual_description', 3],
  ['note', 8],
] as const
const ftsNames = ftsColumns.map(([name]) => name).join(', ')
const ftsWeights = ftsColumns.map(([, weight]) => weight).join(', ')
const ftsValues = (row: 'new' | 'old') => ftsColumns.map(([name]) => `${row}.${name}`).join(', ')

// Small, hot columns first: SQLite walks overflow pages to reach columns after a large value, so
// the visible text and the screenshot come last.
const schema = `
CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  bare TEXT NOT NULL COLLATE NOCASE,
  host TEXT NOT NULL,
  domain TEXT NOT NULL COLLATE NOCASE,
  title TEXT NOT NULL DEFAULT '',
  first_visit_at INTEGER NOT NULL,
  last_visit_at INTEGER NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 0,
  typed_count INTEGER NOT NULL DEFAULT 0,
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  max_dwell_ms INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  note_updated_at INTEGER,
  description TEXT,
  site_name TEXT,
  og_type TEXT,
  image_url TEXT,
  keywords TEXT,
  author TEXT,
  published_at TEXT,
  lang TEXT,
  content_type TEXT,
  content_language TEXT,
  last_modified TEXT,
  http_status INTEGER,
  canonical_link TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  meta_at INTEGER,
  text_hash TEXT,
  summary TEXT,
  visual_description TEXT,
  summary_model TEXT,
  summary_text_hash TEXT,
  summarized_at INTEGER,
  screenshot_at INTEGER,
  text TEXT,
  screenshot BLOB,
  -- Costly data only for pages someone actually spent time on.
  CHECK (screenshot IS NULL OR max_dwell_ms >= ${HIGH_DWELL_MS}),
  CHECK (summary IS NULL OR max_dwell_ms >= ${HIGH_DWELL_MS})
);
CREATE INDEX pages_bare ON pages(bare);
CREATE INDEX pages_domain ON pages(domain);
CREATE INDEX pages_host ON pages(host);
CREATE INDEX pages_last_visit ON pages(last_visit_at);
CREATE INDEX pages_noted ON pages(note_updated_at) WHERE note IS NOT NULL;

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  transition TEXT NOT NULL,
  referrer_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL
);
CREATE INDEX visits_page ON visits(page_id, started_at);
CREATE INDEX visits_started ON visits(started_at);
CREATE INDEX visits_referrer ON visits(referrer_page_id);

CREATE VIRTUAL TABLE pages_fts USING fts5(
  ${ftsNames},
  content='pages', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, ${ftsNames}) VALUES (new.id, ${ftsValues('new')});
END;
CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, ${ftsNames}) VALUES ('delete', old.id, ${ftsValues('old')});
END;
CREATE TRIGGER pages_fts_update AFTER UPDATE OF ${ftsNames} ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, ${ftsNames}) VALUES ('delete', old.id, ${ftsValues('old')});
  INSERT INTO pages_fts(rowid, ${ftsNames}) VALUES (new.id, ${ftsValues('new')});
END;
`

const pageColumns = `p.id, p.url, p.title, p.description, p.last_visit_at, p.visit_count,
  p.dwell_ms, p.note, p.summary, p.screenshot IS NOT NULL AS has_screenshot`

type Row = Record<string, unknown>

function toPage(row: Row): HistoryPage {
  return {
    id: Number(row['id']),
    url: String(row['url']),
    title: String(row['title'] ?? ''),
    description: (row['description'] as string | null) ?? null,
    lastVisitAt: Number(row['last_visit_at']),
    visitCount: Number(row['visit_count']),
    dwellMs: Number(row['dwell_ms']),
    note: (row['note'] as string | null) ?? null,
    summary: (row['summary'] as string | null) ?? null,
    hasScreenshot: Number(row['has_screenshot']) === 1,
    ...(typeof row['snippet'] === 'string' && row['snippet'] && { snippet: row['snippet'] }),
  }
}

export const hashText = (text: string) => createHash('sha256').update(text).digest('hex')

/** Everything a summary request needs about a page. */
export interface SummarySource {
  url: string
  title: string
  description: string | null
  siteName: string | null
  text: string
  textHash: string | null
  sensitive: boolean
  summarizedAt: number | null
  summaryTextHash: string | null
}

/** What semantic search shows the model about a page. */
export interface Candidate {
  id: number
  url: string
  title: string
  lastVisitAt: number
  description: string | null
  summary: string | null
  visualDescription: string | null
  note: string | null
  hasScreenshot: boolean
}

export class HistoryDb {
  private readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      PRAGMA busy_timeout = 2000;
    `)
    const version = Number(
      (this.db.prepare('PRAGMA user_version').get() as Row | undefined)?.['user_version'] ?? 0,
    )
    if (version > SCHEMA_VERSION) {
      throw new Error(`${file} was written by a newer Antimony (schema ${version})`)
    }
    if (version < 1) {
      this.transaction(() => {
        this.db.exec(schema)
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      })
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }

  private transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = body()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Records a visit of a canonical URL; creates the page on its first visit. */
  startVisit(visit: {
    url: string
    title: string
    transition: Transition
    at: number
    referrerPageId: number | null
  }): { pageId: number; visitId: number } {
    return this.transaction(() => {
      const page = this.db
        .prepare(
          `INSERT INTO pages (url, bare, host, domain, title, first_visit_at, last_visit_at,
             visit_count, typed_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(url) DO UPDATE SET
             last_visit_at = max(last_visit_at, excluded.last_visit_at),
             visit_count = visit_count + 1,
             typed_count = typed_count + excluded.typed_count,
             title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END
           RETURNING id`,
        )
        .get(
          visit.url,
          bareUrl(visit.url),
          hostOf(visit.url),
          domainOf(hostOf(visit.url)),
          visit.title,
          visit.at,
          visit.at,
          visit.transition === 'typed' ? 1 : 0,
        ) as Row
      const pageId = Number(page['id'])
      const referrer = visit.referrerPageId === pageId ? null : visit.referrerPageId
      const inserted = this.db
        .prepare(
          `INSERT INTO visits (page_id, started_at, transition, referrer_page_id)
           VALUES (?, ?, ?, ?)`,
        )
        .run(pageId, visit.at, visit.transition, referrer)
      return { pageId, visitId: Number(inserted.lastInsertRowid) }
    })
  }

  /** Adds active time to a visit and its page. */
  addDwell(visitId: number, ms: number): void {
    if (ms <= 0) return
    const delta = Math.round(ms)
    this.transaction(() => {
      const visit = this.db
        .prepare(
          'UPDATE visits SET dwell_ms = dwell_ms + ? WHERE id = ? RETURNING page_id, dwell_ms',
        )
        .get(delta, visitId) as Row | undefined
      if (!visit) return
      this.db
        .prepare(
          `UPDATE pages SET dwell_ms = dwell_ms + ?, max_dwell_ms = max(max_dwell_ms, ?)
           WHERE id = ?`,
        )
        .run(delta, Number(visit['dwell_ms']), Number(visit['page_id']))
    })
  }

  setTitle(pageId: number, title: string): void {
    if (title) this.db.prepare('UPDATE pages SET title = ? WHERE id = ?').run(title, pageId)
  }

  setStatus(pageId: number, status: number): void {
    this.db.prepare('UPDATE pages SET http_status = ? WHERE id = ?').run(status, pageId)
  }

  /** Stores header metadata and visible text (dropped, with costly data, for sensitive pages). */
  setMeta(pageId: number, meta: PageMeta, at: number): void {
    const text = meta.sensitive ? null : meta.text || null
    this.db
      .prepare(
        `UPDATE pages SET
           title = CASE WHEN ? <> '' THEN ? ELSE title END,
           description = ?, site_name = ?, og_type = ?, image_url = ?, keywords = ?, author = ?,
           published_at = ?, lang = ?, content_type = ?, content_language = ?, last_modified = ?,
           canonical_link = ?, sensitive = ?, meta_at = ?, text = ?, text_hash = ?
           ${meta.sensitive ? ', screenshot = NULL, screenshot_at = NULL, summary = NULL, visual_description = NULL, summarized_at = NULL, summary_model = NULL, summary_text_hash = NULL' : ''}
         WHERE id = ?`,
      )
      .run(
        meta.title,
        meta.title,
        meta.description,
        meta.siteName,
        meta.ogType,
        meta.imageUrl,
        meta.keywords,
        meta.author,
        meta.publishedAt,
        meta.lang,
        meta.contentType,
        meta.contentLanguage,
        meta.lastModified,
        meta.canonicalLink,
        meta.sensitive ? 1 : 0,
        at,
        text,
        text === null ? null : hashText(text),
        pageId,
      )
  }

  /**
   * Moves a visit to the page of another canonical URL (the page's rel=canonical applied).
   * Returns the new page id. The old page goes when no visits and no note are left.
   */
  moveVisit(visitId: number, url: string): number {
    return this.transaction(() => {
      const visit = this.db
        .prepare('SELECT page_id, started_at, dwell_ms, transition FROM visits WHERE id = ?')
        .get(visitId) as Row | undefined
      if (!visit) throw new Error(`no visit ${visitId}`)
      const from = Number(visit['page_id'])
      const startedAt = Number(visit['started_at'])
      const dwell = Number(visit['dwell_ms'])
      const typed = visit['transition'] === 'typed' ? 1 : 0
      const old = this.db.prepare('SELECT title FROM pages WHERE id = ?').get(from) as Row
      const target = this.db
        .prepare(
          `INSERT INTO pages (url, bare, host, domain, title, first_visit_at, last_visit_at,
             visit_count, typed_count, dwell_ms, max_dwell_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(url) DO UPDATE SET
             last_visit_at = max(last_visit_at, excluded.last_visit_at),
             visit_count = visit_count + 1,
             typed_count = typed_count + excluded.typed_count,
             dwell_ms = dwell_ms + excluded.dwell_ms,
             max_dwell_ms = max(max_dwell_ms, excluded.max_dwell_ms)
           RETURNING id`,
        )
        .get(
          url,
          bareUrl(url),
          hostOf(url),
          domainOf(hostOf(url)),
          String(old['title'] ?? ''),
          startedAt,
          startedAt,
          typed,
          dwell,
          dwell,
        ) as Row
      const to = Number(target['id'])
      if (to === from) return to
      this.db.prepare('UPDATE visits SET page_id = ? WHERE id = ?').run(to, visitId)
      const longest = Number(
        (
          this.db
            .prepare('SELECT coalesce(max(dwell_ms), 0) AS m FROM visits WHERE page_id = ?')
            .get(from) as Row
        )['m'],
      )
      // Costly data must go if the old page no longer has a long enough visit.
      this.db
        .prepare(
          `UPDATE pages SET visit_count = max(0, visit_count - 1),
             typed_count = max(0, typed_count - ?), dwell_ms = max(0, dwell_ms - ?),
             max_dwell_ms = ?,
             screenshot = CASE WHEN ? >= ${HIGH_DWELL_MS} THEN screenshot END,
             screenshot_at = CASE WHEN ? >= ${HIGH_DWELL_MS} THEN screenshot_at END,
             summary = CASE WHEN ? >= ${HIGH_DWELL_MS} THEN summary END,
             visual_description = CASE WHEN ? >= ${HIGH_DWELL_MS} THEN visual_description END
           WHERE id = ?`,
        )
        .run(typed, dwell, longest, longest, longest, longest, longest, from)
      this.db
        .prepare('DELETE FROM pages WHERE id = ? AND visit_count = 0 AND note IS NULL')
        .run(from)
      return to
    })
  }

  /** True when the page has no screenshot, or one older than a week. */
  needsScreenshot(pageId: number, now: number): boolean {
    const row = this.db
      .prepare('SELECT screenshot_at, sensitive FROM pages WHERE id = ?')
      .get(pageId) as Row | undefined
    if (!row || Number(row['sensitive']) === 1) return false
    const at = row['screenshot_at'] as number | null
    return at === null || now - Number(at) > WEEK_MS
  }

  setScreenshot(pageId: number, jpeg: Uint8Array, at: number): void {
    this.db
      .prepare('UPDATE pages SET screenshot = ?, screenshot_at = ? WHERE id = ? AND sensitive = 0')
      .run(jpeg, at, pageId)
  }

  screenshot(pageId: number): Uint8Array | null {
    const row = this.db.prepare('SELECT screenshot FROM pages WHERE id = ?').get(pageId) as
      Row | undefined
    return (row?.['screenshot'] as Uint8Array | null | undefined) ?? null
  }

  summarySource(pageId: number): SummarySource | null {
    const row = this.db
      .prepare(
        `SELECT url, title, description, site_name, text, text_hash, sensitive, summarized_at,
           summary_text_hash FROM pages WHERE id = ?`,
      )
      .get(pageId) as Row | undefined
    if (!row) return null
    return {
      url: String(row['url']),
      title: String(row['title'] ?? ''),
      description: (row['description'] as string | null) ?? null,
      siteName: (row['site_name'] as string | null) ?? null,
      text: String(row['text'] ?? ''),
      textHash: (row['text_hash'] as string | null) ?? null,
      sensitive: Number(row['sensitive']) === 1,
      summarizedAt: (row['summarized_at'] as number | null) ?? null,
      summaryTextHash: (row['summary_text_hash'] as string | null) ?? null,
    }
  }

  setSummary(
    pageId: number,
    summary: {
      summary: string
      visualDescription: string | null
      model: string
      textHash: string | null
    },
    at: number,
  ): void {
    this.db
      .prepare(
        `UPDATE pages SET summary = ?, visual_description = ?, summary_model = ?,
           summary_text_hash = ?, summarized_at = ?
         WHERE id = ? AND sensitive = 0`,
      )
      .run(summary.summary, summary.visualDescription, summary.model, summary.textHash, at, pageId)
  }

  /** Sets the note ('' or null removes it). */
  setNote(pageId: number, note: string | null, at: number): boolean {
    const value = note?.trim() ? note.trim() : null
    const result = this.db
      .prepare('UPDATE pages SET note = ?, note_updated_at = ? WHERE id = ?')
      .run(value, value === null ? null : at, pageId)
    return Number(result.changes) > 0
  }

  page(pageId: number): HistoryPage | null {
    const row = this.db.prepare(`SELECT ${pageColumns} FROM pages p WHERE p.id = ?`).get(pageId) as
      Row | undefined
    return row ? toPage(row) : null
  }

  pageIdOf(url: string): number | null {
    const row = this.db.prepare('SELECT id FROM pages WHERE url = ?').get(url) as Row | undefined
    return row ? Number(row['id']) : null
  }

  /**
   * Visited pages whose bare URL or domain starts with `typed`, by frecency: visits (typed ones
   * count three times) divided by age in weeks. Both conditions are index range scans.
   */
  suggest(typed: string, limit: number, now: number): VisitedSuggestion[] {
    const prefix = bareInput(typed)
    if (!prefix) return []
    const end = `${prefix}\u{10FFFF}`
    const rows = this.db
      .prepare(
        `SELECT url, title FROM pages
         WHERE (bare >= ?1 AND bare < ?2) OR (domain >= ?1 AND domain < ?2)
         ORDER BY (visit_count + 2 * typed_count) / (1.0 + (?3 - last_visit_at) / ${WEEK_MS}.0) DESC
         LIMIT ?4`,
      )
      .all(prefix, end, now, limit) as Row[]
    return rows.map((row) => ({ url: String(row['url']), title: String(row['title'] ?? '') }))
  }

  /** Full-text search (`match` from ftsQuery), or the most recent pages when `match` is null. */
  search(match: string | null, options: { bookmarked: boolean; limit: number }): HistoryPage[] {
    const noted = options.bookmarked ? 'AND p.note IS NOT NULL' : ''
    if (match === null) {
      const order = options.bookmarked ? 'p.note_updated_at' : 'p.last_visit_at'
      const rows = this.db
        .prepare(
          `SELECT ${pageColumns} FROM pages p WHERE 1 ${noted} ORDER BY ${order} DESC LIMIT ?`,
        )
        .all(options.limit) as Row[]
      return rows.map(toPage)
    }
    const rows = this.db
      .prepare(
        `SELECT ${pageColumns},
           snippet(pages_fts, -1, char(2), char(3), '…', 16) AS snippet
         FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid
         WHERE pages_fts MATCH ? ${noted}
         ORDER BY bm25(pages_fts, ${ftsWeights}), p.last_visit_at DESC
         LIMIT ?`,
      )
      .all(match, options.limit) as Row[]
    return rows.map(toPage)
  }

  /** Recent pages that have a summary or a note: what semantic search knows best. */
  recentDescribed(limit: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM pages WHERE summary IS NOT NULL OR note IS NOT NULL
         ORDER BY last_visit_at DESC LIMIT ?`,
      )
      .all(limit) as Row[]
    return rows.map((row) => Number(row['id']))
  }

  /** Recent pages that have a screenshot: what a sketch can be compared with. */
  recentWithScreenshot(limit: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM pages WHERE screenshot_at IS NOT NULL
         ORDER BY last_visit_at DESC LIMIT ?`,
      )
      .all(limit) as Row[]
    return rows.map((row) => Number(row['id']))
  }

  candidates(ids: number[]): Candidate[] {
    const statement = this.db.prepare(
      `SELECT id, url, title, last_visit_at, description, summary, visual_description, note,
         screenshot IS NOT NULL AS has_screenshot
       FROM pages WHERE id = ?`,
    )
    return ids.flatMap((id) => {
      const row = statement.get(id) as Row | undefined
      if (!row) return []
      return [
        {
          id,
          url: String(row['url']),
          title: String(row['title'] ?? ''),
          lastVisitAt: Number(row['last_visit_at']),
          description: (row['description'] as string | null) ?? null,
          summary: (row['summary'] as string | null) ?? null,
          visualDescription: (row['visual_description'] as string | null) ?? null,
          note: (row['note'] as string | null) ?? null,
          hasScreenshot: Number(row['has_screenshot']) === 1,
        },
      ]
    })
  }

  /** The most recently visited pages since `since` matching `text` (title, address, keywords). */
  mapPages(since: number | null, text: string, limit: number): { rows: MapRow[]; total: number } {
    const like = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    const where = `(? IS NULL OR last_visit_at >= ?) AND
      (? = '' OR title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR keywords LIKE ? ESCAPE '\\')`
    const params = [since, since, text, like, like, like]
    const total = Number(
      (this.db.prepare(`SELECT count(*) AS n FROM pages WHERE ${where}`).get(...params) as Row)[
        'n'
      ],
    )
    const rows = this.db
      .prepare(
        `SELECT id, url, title, domain, visit_count, last_visit_at, keywords FROM pages
         WHERE ${where} ORDER BY last_visit_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, limit) as Row[]
    return {
      total,
      rows: rows.map((row) => ({
        id: Number(row['id']),
        url: String(row['url']),
        title: String(row['title'] ?? ''),
        domain: String(row['domain'] ?? ''),
        visitCount: Number(row['visit_count']),
        lastVisitAt: Number(row['last_visit_at']),
        keywords: (row['keywords'] as string | null) ?? null,
      })),
    }
  }

  /** How often a visit to one of `ids` came from another page of `ids` (a followed link). */
  follows(ids: number[]): Follow[] {
    if (ids.length === 0) return []
    const known = new Set(ids)
    const rows = this.db
      .prepare(
        `SELECT referrer_page_id AS source, page_id AS target, count(*) AS n FROM visits
         WHERE referrer_page_id IS NOT NULL AND page_id IN (${ids.map(() => '?').join(',')})
         GROUP BY referrer_page_id, page_id ORDER BY referrer_page_id, page_id`,
      )
      .all(...ids) as Row[]
    return rows
      .filter((row) => known.has(Number(row['source'])))
      .map((row) => ({
        from: Number(row['source']),
        to: Number(row['target']),
        count: Number(row['n']),
      }))
  }

  /** Pages by id, in the given order, optionally only noted ones. */
  pages(ids: number[], bookmarked = false): HistoryPage[] {
    const statement = this.db.prepare(`SELECT ${pageColumns} FROM pages p WHERE p.id = ?`)
    return ids.flatMap((id) => {
      const row = statement.get(id) as Row | undefined
      if (!row || (bookmarked && row['note'] === null)) return []
      return [toPage(row)]
    })
  }

  delete(pageId: number): void {
    this.db.prepare('DELETE FROM pages WHERE id = ?').run(pageId)
  }

  /**
   * Removes history. Without `all`, noted pages (bookmarks) keep their URL, title and note but
   * lose their visits, times, text, screenshot and summary.
   */
  clear(all: boolean): void {
    this.transaction(() => {
      if (all) {
        this.db.exec('DELETE FROM pages')
        return
      }
      this.db.exec('DELETE FROM pages WHERE note IS NULL')
      this.db.exec('DELETE FROM visits')
      this.db.exec(`UPDATE pages SET visit_count = 0, typed_count = 0, dwell_ms = 0,
        max_dwell_ms = 0, text = NULL, text_hash = NULL, screenshot = NULL, screenshot_at = NULL,
        summary = NULL, visual_description = NULL, summary_model = NULL, summary_text_hash = NULL,
        summarized_at = NULL`)
    })
    this.db.exec("INSERT INTO pages_fts(pages_fts) VALUES ('optimize')")
    this.db.exec('VACUUM')
  }

  /** For tests and diagnostics: the query plan of a statement. */
  explain(sql: string, ...params: (string | number)[]): string[] {
    const rows = this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Row[]
    return rows.map((row) => String(row['detail']))
  }

  /** For tests: runs a statement directly. */
  raw(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[]
  }
}
