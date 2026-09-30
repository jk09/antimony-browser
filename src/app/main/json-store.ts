import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** A small JSON file under userData, read once and written at most every `delayMs`. */
export interface JsonStore<T> {
  get(): T
  set(value: T): void
  /** Writes a pending change now (called on quit). */
  flush(): void
}

export interface JsonStoreOptions<T> {
  /** Turns the parsed file into a value; throw if it isn't valid. */
  parse: (raw: unknown) => T
  fallback: () => T
  delayMs?: number
}

/**
 * Loads `file`, or starts from `fallback` if it's missing. A file that can't be parsed or fails
 * `parse` is renamed to `<name>.corrupt-<time>.json` so no data is silently overwritten.
 */
export function createJsonStore<T>(file: string, options: JsonStoreOptions<T>): JsonStore<T> {
  const { parse, fallback, delayMs = 500 } = options
  let value = load()
  let timer: ReturnType<typeof setTimeout> | null = null

  function load(): T {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return fallback()
    }
    try {
      return parse(JSON.parse(text))
    } catch (error) {
      const aside = file.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`
      console.warn(`${file} is invalid, moved to ${aside}`, error)
      try {
        renameSync(file, aside)
      } catch {
        // Nothing more to do; the next write replaces it.
      }
      return fallback()
    }
  }

  function write() {
    timer = null
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
      renameSync(`${file}.tmp`, file)
    } catch (error) {
      console.warn(`Failed to write ${file}`, error)
    }
  }

  return {
    get: () => value,
    set(next) {
      value = next
      timer ??= setTimeout(write, delayMs)
    },
    flush() {
      if (timer === null) return
      clearTimeout(timer)
      write()
    },
  }
}
