import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MAX_PENDING, parseReports, type CrashReport } from '../shared/report'

/**
 * Crash reports waiting for the user's answer, in a JSON file written synchronously: the app may
 * be about to die. A missing or corrupt file reads as no reports; nothing here throws.
 */
export interface CrashStore {
  get(): CrashReport[]
  /** Keeps the newest MAX_PENDING. */
  add(report: CrashReport): void
  clear(): void
}

export function createCrashStore(file: string): CrashStore {
  const get = (): CrashReport[] => {
    try {
      return parseReports(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      return []
    }
  }
  return {
    get,
    add(report) {
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify([...get(), report].slice(-MAX_PENDING), null, 2))
      } catch (error) {
        console.error('Could not store the crash report', error)
      }
    },
    clear() {
      try {
        rmSync(file, { force: true })
      } catch (error) {
        console.error('Could not remove the crash reports', error)
      }
    },
  }
}
