// User text → an FTS5 MATCH expression that can't carry FTS syntax (column filters, NEAR, ^, *).

const MAX_TERMS = 16

/** Words in `input`: runs of letters and digits, lowercased, de-duplicated. */
export function terms(input: string): string[] {
  const words = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words)].slice(0, MAX_TERMS)
}

/**
 * A MATCH expression with every word as a quoted prefix term, all required (`and`) or any of
 * them (`or`). Null when there are no words.
 */
export function ftsQuery(input: string, join: 'and' | 'or' = 'and'): string | null {
  const words = terms(input)
  if (words.length === 0) return null
  return words.map((word) => `"${word}"*`).join(join === 'and' ? ' ' : ' OR ')
}
