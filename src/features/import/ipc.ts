export const channels = {
  choose: 'import:choose',
  run: 'import:run',
} as const

/** Longest export file import reads, bytes. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024
/** Most rows an export may have. */
export const MAX_ROWS = 200_000
/** Longest path accepted. */
export const MAX_PATH = 4096

/** What an import did; shown by the welcome step and (as one line) returned to the skill. */
export interface ImportResult {
  /** Data rows in the file (blank lines excluded). */
  rows: number
  /** Visits added to history. */
  visitsImported: number
  pagesCreated: number
  pagesUpdated: number
  /** Rows already in history (same page and time) and left out. */
  duplicates: number
  skipped: { invalid: number; unsupported: number }
  stacksCreated: number
  /** Groups that could have been stacks but weren't (already imported, or no room left). */
  stacksSkipped: number
  /** How pages were grouped: by what the assistant made of them, or by address alone. */
  grouping: 'topics' | 'addresses'
  /** Why the assistant's grouping wasn't used, when it was tried. */
  topicsError?: string
}

export interface ImportApi {
  /** Opens the file dialog; the chosen path, or null if the user cancelled. */
  choose(): Promise<string | null>
  /** Imports an Edge "Export browsing data" CSV; rejects with a readable error. */
  run(path: string): Promise<ImportResult>
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** One sentence for the result, e.g. "Imported 1,204 visits (310 new pages) into history …". */
export function describeResult(result: ImportResult): string {
  const skipped = result.skipped.invalid + result.skipped.unsupported
  const how =
    result.grouping === 'topics'
      ? 'grouped by topic'
      : `grouped by address${result.topicsError ? " (the assistant wasn't available)" : ''}`
  const parts = [
    `Imported ${count(result.visitsImported, 'visit')} (${count(result.pagesCreated, 'new page')}) into history and ${count(result.stacksCreated, 'stack')}, ${how}`,
  ]
  const notes: string[] = []
  if (skipped > 0) notes.push(`skipped ${count(skipped, 'row')}`)
  if (result.duplicates > 0) notes.push(`${count(result.duplicates, 'row')} already in history`)
  if (result.stacksSkipped > 0) {
    notes.push(`${count(result.stacksSkipped, 'group')} not made into stacks`)
  }
  return `${parts[0]}${notes.length > 0 ? `; ${notes.join('; ')}` : ''}.`
}
