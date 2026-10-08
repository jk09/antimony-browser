import type { MapEdge, MapGroup, MapNode, MapResult } from '../ipc'

/** A page as the map reads it from the database. */
export interface MapRow {
  id: number
  url: string
  title: string
  domain: string
  visitCount: number
  lastVisitAt: number
  keywords: string | null
}

/** `from` led to `to` `count` times. */
export interface Follow {
  from: number
  to: number
  count: number
}

/** Pages whose keyword sets overlap at least this much (Jaccard) belong together. */
export const GROUP_OVERLAP = 0.3
/** Pages sharing at least this many keywords are joined by a keyword edge. */
export const EDGE_SHARED = 2
const MAX_KEYWORDS = 12

/** The keywords of a page's meta tag: lowercase, distinct, at most 12. */
export function parseKeywords(raw: string | null): string[] {
  if (!raw) return []
  const words = raw
    .split(/[,;]/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 1 && word.length <= 40)
  return [...new Set(words)].slice(0, MAX_KEYWORDS)
}

const shared = (a: Set<string>, b: Set<string>) => {
  let count = 0
  for (const word of a) if (b.has(word)) count++
  return count
}

const overlap = (a: Set<string>, b: Set<string>) => {
  const both = shared(a, b)
  return both === 0 ? 0 : both / (a.size + b.size - both)
}

/**
 * Groups pages that share a domain or whose keywords overlap, joins them with link and keyword
 * edges and labels each group. Deterministic and local: no model is involved.
 */
export function buildMap(rows: MapRow[], follows: Follow[], total = rows.length): MapResult {
  const sets = new Map(rows.map((row) => [row.id, new Set(parseKeywords(row.keywords))]))
  const parent = new Map(rows.map((row) => [row.id, row.id]))
  const find = (id: number): number => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(id, root)
    return root
  }
  const union = (a: number, b: number) => {
    const [rootA, rootB] = [find(a), find(b)]
    if (rootA !== rootB) parent.set(Math.max(rootA, rootB), Math.min(rootA, rootB))
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [a, b] = [rows[i]!, rows[j]!]
      if (
        (a.domain !== '' && a.domain === b.domain) ||
        overlap(sets.get(a.id)!, sets.get(b.id)!) >= GROUP_OVERLAP
      ) {
        union(a.id, b.id)
      }
    }
  }

  const members = new Map<number, MapRow[]>()
  for (const row of rows) members.set(find(row.id), [...(members.get(find(row.id)) ?? []), row])
  const groups: MapGroup[] = []
  const groupOf = new Map<number, number>()
  const ordered = [...members.values()]
    .filter((pages) => pages.length > 1)
    .sort((a, b) => b.length - a.length || a[0]!.id - b[0]!.id)
  for (const pages of ordered) {
    const id = groups.length + 1
    const counts = new Map<string, number>()
    for (const page of pages) {
      for (const word of sets.get(page.id)!) counts.set(word, (counts.get(word) ?? 0) + 1)
    }
    const [top] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const label = top && top[1] > 1 ? top[0] : pages[0]!.domain || pages[0]!.url
    groups.push({ id, label, pageIds: pages.map((page) => page.id) })
    for (const page of pages) groupOf.set(page.id, id)
  }

  const nodes: MapNode[] = rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    domain: row.domain,
    visitCount: row.visitCount,
    lastVisitAt: row.lastVisitAt,
    keywords: [...sets.get(row.id)!],
    group: groupOf.get(row.id) ?? null,
  }))

  const edges: MapEdge[] = []
  const linked = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)
  const seen = new Set<string>()
  for (const { from, to, count } of follows) {
    if (from === to || !sets.has(from) || !sets.has(to) || seen.has(`${from}>${to}`)) continue
    seen.add(`${from}>${to}`)
    linked.add(key(from, to))
    edges.push({ from, to, kind: 'link', weight: count })
  }
  for (const group of groups) {
    for (let i = 0; i < group.pageIds.length; i++) {
      for (let j = i + 1; j < group.pageIds.length; j++) {
        const [a, b] = [group.pageIds[i]!, group.pageIds[j]!]
        const both = shared(sets.get(a)!, sets.get(b)!)
        if (both >= EDGE_SHARED && !linked.has(key(a, b))) {
          edges.push({ from: Math.min(a, b), to: Math.max(a, b), kind: 'keyword', weight: both })
        }
      }
    }
  }
  return { nodes, edges, groups, total: Math.max(total, rows.length) }
}
