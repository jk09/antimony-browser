import { HISTORY_LIMIT, type HistoryEntry, type HistoryKind } from '../ipc'

/** Adds an entry at the front, dropping an older copy of the same text and anything over the cap. */
export function addEntry(
  history: HistoryEntry[],
  entry: { kind: HistoryKind; text: string },
  at: number,
  limit = HISTORY_LIMIT,
): HistoryEntry[] {
  const text = entry.text.trim()
  if (!text) return history
  return [
    { kind: entry.kind, text, at },
    ...history.filter((old) => !(old.kind === entry.kind && old.text === text)),
  ].slice(0, limit)
}

/**
 * What gets remembered of a submitted command: never an API key typed after /key, only the
 * command itself.
 */
export function historyText(text: string): string {
  return /^\/key(\s|$)/i.test(text.trim()) ? '/key' : text.trim()
}
