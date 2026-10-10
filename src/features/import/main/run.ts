// Reads an Edge export file and feeds history and stacks. Needs Node's fs but not electron, so it
// is unit-tested with fakes for the two ports.
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, extname } from 'node:path'
import { describeResult, MAX_FILE_BYTES, MAX_PATH, MAX_ROWS, type ImportResult } from '../ipc'
import { ImportFileError, parseEdgeCsv } from '../shared/edge-csv'
import { chainOrder, groupByAddress, pagesOf, placeLeftovers } from '../shared/grouping'
import { refineByTopics, type Complete } from './topics'

export { ImportFileError }

export interface ImportPorts {
  /** History's `importVisits`. */
  importVisits(visits: { url: string; title: string; at: number }[]): {
    visitsImported: number
    pagesCreated: number
    pagesUpdated: number
    duplicates: number
    invalid: number
  }
  /** Stacks' `importStacks`. */
  importStacks(
    stacks: { name: string; lastAt: number; pages: { url: string; title: string; at: number }[] }[],
  ): { created: number; skipped: number }
  /** One request to the selected model (agent's `complete`); without it only addresses group. */
  complete?: Complete
}

/** The model gets this long to group by topic. */
const TOPICS_TIMEOUT_MS = 60_000

/**
 * The absolute path a typed or chosen path names: surrounding quotes dropped, `~/` expanded.
 * Throws an ImportFileError (read by the user and the model) unless it names a `.csv` file.
 */
export function resolveExportPath(raw: string, home: string = homedir()): string {
  let path = raw
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim()
  if (path === '') throw new ImportFileError('Give the path of the exported .csv file.')
  if (path.length > MAX_PATH) throw new ImportFileError('The path is too long.')
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) {
    path = join(home, path.slice(1))
  }
  if (!isAbsolute(path)) {
    throw new ImportFileError(`${path} isn't a full path (starting with / or a drive, or ~/).`)
  }
  if (extname(path).toLowerCase() !== '.csv') {
    throw new ImportFileError('Only the .csv file Edge creates can be imported.')
  }
  return path
}

/** Imports the export at `rawPath`; history is written all or nothing, then stacks are added. */
export async function runImport(
  rawPath: string,
  ports: ImportPorts,
  now: number = Date.now(),
  signal?: AbortSignal,
): Promise<ImportResult> {
  const path = resolveExportPath(rawPath)
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new ImportFileError(`${path} isn't a file.`)
    size = info.size
  } catch (error) {
    if (error instanceof ImportFileError) throw error
    throw new ImportFileError(`Can't read ${path}: it doesn't exist or isn't readable.`)
  }
  if (size > MAX_FILE_BYTES) throw new ImportFileError('The file is larger than 50 MB.')
  const text = (await readFile(path)).toString('utf8')
  const parsed = parseEdgeCsv(text, now)
  if (parsed.total > MAX_ROWS) {
    throw new ImportFileError(`The file has more than ${MAX_ROWS.toLocaleString('en-US')} rows.`)
  }

  // Grouping first, so nothing is written if it fails. By address, then by topic when the model
  // can tell; a model that can't never fails the import.
  const pages = pagesOf(parsed.rows)
  let { groups, leftovers } = groupByAddress(pages)
  let grouping: ImportResult['grouping'] = 'addresses'
  let topicsError: string | undefined
  if (ports.complete && groups.length + leftovers.length > 0) {
    try {
      const timeout = AbortSignal.timeout(TOPICS_TIMEOUT_MS)
      ;({ groups, leftovers } = await refineByTopics(
        ports.complete,
        groups,
        leftovers,
        signal ? AbortSignal.any([signal, timeout]) : timeout,
      ))
      grouping = 'topics'
    } catch (error) {
      if (signal?.aborted) throw error
      topicsError = error instanceof Error ? error.message : String(error)
    }
  }
  placeLeftovers(groups, leftovers, pages)
  const stackGroups = groups.map((group) => ({
    name: group.label,
    lastAt: Math.max(...group.pages.map((page) => page.lastAt)),
    pages: chainOrder(group.pages).map(({ url, title, firstAt }) => ({ url, title, at: firstAt })),
  }))

  const history = ports.importVisits(parsed.rows)
  const stacks = ports.importStacks(stackGroups)
  return {
    rows: parsed.total,
    visitsImported: history.visitsImported,
    pagesCreated: history.pagesCreated,
    pagesUpdated: history.pagesUpdated,
    duplicates: history.duplicates,
    skipped: { invalid: parsed.invalid + history.invalid, unsupported: parsed.unsupported },
    stacksCreated: stacks.created,
    stacksSkipped: stacks.skipped,
    grouping,
    ...(topicsError && { topicsError }),
  }
}

export { describeResult }
