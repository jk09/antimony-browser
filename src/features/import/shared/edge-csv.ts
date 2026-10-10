// Parsing of the CSV Edge's "Export browsing data" creates. Pure: no electron, Node or React
// imports. Columns are found by their header, so the order and exact names may vary.

/** One visit read from the file. */
export interface ImportRow {
  url: string
  title: string
  /** Epoch milliseconds. */
  at: number
}

export interface ParsedExport {
  rows: ImportRow[]
  /** Data rows in the file (blank lines excluded). */
  total: number
  /** Rows without a readable address or time. */
  invalid: number
  /** Rows whose address isn't http(s) (edge://, file:, data:, …). */
  unsupported: number
}

/** The file isn't an Edge browsing-data export we can read; the message says why. */
export class ImportFileError extends Error {}

const MAX_TITLE = 500

/** Splits CSV text into records: quotes, `""`, embedded newlines, CRLF or LF; blank lines dropped. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let touched = false
  const endField = () => {
    record.push(field)
    field = ''
  }
  const endRecord = () => {
    endField()
    if (touched || record.some((value) => value !== '')) records.push(record)
    record = []
    touched = false
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
      touched = true
    } else if (char === delimiter) {
      endField()
      touched = true
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      endRecord()
    } else field += char
  }
  if (field !== '' || record.length > 0 || touched) endRecord()
  return records
}

/** The delimiter of the header line: `;` if it has more of them (outside quotes) than commas. */
function delimiterOf(text: string): string {
  let commas = 0
  let semicolons = 0
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) break
    else if (!quoted && char === ',') commas++
    else if (!quoted && char === ';') semicolons++
  }
  return semicolons > commas ? ';' : ','
}

const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '')

const URL_NAMES = ['url', 'address', 'link', 'pageurl', 'weburl', 'uri', 'siteurl']
const TITLE_NAMES = ['title', 'pagetitle', 'name', 'pagename']
const TIME_NAMES = [
  'visittime',
  'lastvisittime',
  'lastvisitdate',
  'lastvisited',
  'visited',
  'visitdate',
  'visitedon',
  'date',
  'time',
  'timestamp',
  'datetime',
]

function findColumn(keys: string[], names: string[], contains: string[]): number {
  for (const name of names) {
    const index = keys.indexOf(name)
    if (index >= 0) return index
  }
  return keys.findIndex((candidate) => contains.some((part) => candidate.includes(part)))
}

/**
 * Epoch milliseconds of a visit time, or null. Accepts epoch seconds, milliseconds or
 * microseconds, WebKit time (microseconds since 1601), ISO 8601, `YYYY-MM-DD HH:MM[:SS]` (UTC
 * without an offset) and whatever `Date.parse` reads. Later than `now` is clamped to `now`.
 */
export function parseTime(value: string, now: number): number | null {
  const text = value.trim()
  if (text === '') return null
  let at: number
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text)
    if (n >= 1e16) at = n / 1000 - 11_644_473_600_000
    else if (n >= 1e14) at = n / 1000
    else if (n >= 1e11) at = n
    else if (n >= 1e8) at = n * 1000
    else return null
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
    at = Date.parse(`${text.replace(' ', 'T')}Z`)
  } else {
    at = Date.parse(text)
  }
  if (!Number.isFinite(at) || at <= 0) return null
  return Math.min(Math.round(at), now)
}

/** The http(s) form of an address, 'unsupported' for other schemes, or null if unreadable. */
function webUrl(value: string): string | 'unsupported' | null {
  const text = value.trim()
  if (text === '') return null
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : 'unsupported'
  } catch {
    return null
  }
}

/**
 * Reads an Edge browsing-data export. Throws ImportFileError when the file has no header with an
 * address and a time column (a passwords export, say). Rows that can't be used are counted.
 */
export function parseEdgeCsv(input: string, now: number = Date.now()): ParsedExport {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const records = parseCsv(text, delimiterOf(text))
  const header = records[0]
  if (!header) throw new ImportFileError('The file is empty.')
  const keys = header.map(key)
  const urlColumn = findColumn(keys, URL_NAMES, ['url'])
  const timeColumn = findColumn(keys, TIME_NAMES, ['time', 'date', 'visit'])
  if (urlColumn < 0 || timeColumn < 0) {
    const found = header.map((name) => name.trim()).filter(Boolean)
    throw new ImportFileError(
      `This doesn't look like Edge's browsing-data export: it needs an address and a visit-time column, found ${found.length > 0 ? found.slice(0, 12).join(', ') : 'none'}.`,
    )
  }
  const titleColumn = findColumn(keys, TITLE_NAMES, ['title'])

  const rows: ImportRow[] = []
  let invalid = 0
  let unsupported = 0
  for (const record of records.slice(1)) {
    const url = webUrl(record[urlColumn] ?? '')
    const at = parseTime(record[timeColumn] ?? '', now)
    if (url === 'unsupported') unsupported++
    else if (url === null || at === null) invalid++
    else {
      const title = titleColumn >= 0 ? (record[titleColumn] ?? '') : ''
      rows.push({ url, title: title.trim().slice(0, MAX_TITLE), at })
    }
  }
  return { rows, total: records.length - 1, invalid, unsupported }
}
