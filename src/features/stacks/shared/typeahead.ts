// Type-ahead matching for the tree, as in a file manager. Pure: no electron, Node or React imports.

/**
 * The index of the label that `prefix` selects, or -1. Case-insensitive; the search wraps. A prefix
 * of one repeated letter ("a", "aa") steps to the next label starting with that letter; a longer
 * prefix may stay on the label at `from` when it still matches.
 */
export function findMatch(labels: string[], from: number, prefix: string): number {
  const needle = prefix.toLowerCase()
  if (needle === '' || labels.length === 0) return -1
  const repeated = [...needle].every((char) => char === needle[0])
  const text = repeated ? needle[0]! : needle
  const first = repeated ? from + 1 : from
  for (let step = 0; step < labels.length; step++) {
    const index = (((first + step) % labels.length) + labels.length) % labels.length
    if (labels[index]!.toLowerCase().startsWith(text)) return index
  }
  return -1
}
