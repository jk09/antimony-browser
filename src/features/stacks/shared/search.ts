// Searching the pages of a stack. Pure: no electron, Node or React imports.

/** A page to search: its title (may be empty) and URL. */
export interface Searchable {
  title: string
  url: string
}

/** A `[start, end)` range of a string. */
export type Range = [number, number]

/** How long the scheme (and `www.`) of `url` is: the part search skips, so `h` misses `https`. */
export const urlPrefixLength = (url: string) =>
  /^[a-z][\w+.-]*:(\/\/)?(www\.)?/i.exec(url)?.[0].length ?? 0

/** The query's words, lower-cased. */
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * The indexes of the pages whose title or URL (without its scheme) contains every word of `query`
 * (case-insensitive), in order. An empty query matches nothing.
 */
export function searchPages(pages: Searchable[], query: string): number[] {
  const words = queryWords(query)
  if (words.length === 0) return []
  const hits: number[] = []
  pages.forEach((page, index) => {
    const text = `${page.title}\n${page.url.slice(urlPrefixLength(page.url))}`.toLowerCase()
    if (words.every((word) => text.includes(word))) hits.push(index)
  })
  return hits
}

/** Where the query's words occur in `text`, sorted and merged, for highlighting. */
export function matchRanges(text: string, query: string): Range[] {
  const lower = text.toLowerCase()
  const ranges: Range[] = []
  for (const word of queryWords(query)) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) {
      ranges.push([at, at + word.length])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Range[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  return merged
}
