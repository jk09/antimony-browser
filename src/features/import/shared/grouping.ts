// Groups imported pages by how related their addresses are. Pure: no electron, Node or React
// imports.
import type { ImportRow } from './edge-csv'

/** Most stacks an import creates. */
export const MAX_GROUPS = 30
/** A site with more pages than this is split by the first part of the path. */
export const SPLIT_ABOVE = 60
/** A path part needs this many pages to become a group of its own. */
export const SPLIT_MIN = 3
/** Newest pages kept in one group. */
export const MAX_GROUP_PAGES = 500

/** A page of the export: one address (without its fragment) with the visits to it. */
export interface ImportPage {
  url: string
  title: string
  firstAt: number
  lastAt: number
  visits: number
}

/** Pages that belong in one stack. */
export interface ImportGroup {
  /** Names the stack when the assistant didn't (`github`, `github-torvalds`). */
  label: string
  pages: ImportPage[]
}

export interface AddressGrouping {
  /** Largest first. */
  groups: ImportGroup[]
  /** Pages in no group: alone on their site, or on a site that didn't make the cut. */
  leftovers: ImportPage[]
}

const withoutFragment = (url: string) => url.replace(/#.*$/, '')

/** One page per address, with its first non-empty title and the first and last visit. */
export function pagesOf(rows: ImportRow[]): ImportPage[] {
  const pages = new Map<string, ImportPage>()
  for (const row of rows) {
    const key = withoutFragment(row.url)
    const page = pages.get(key)
    if (!page) {
      pages.set(key, { url: row.url, title: row.title, firstAt: row.at, lastAt: row.at, visits: 1 })
      continue
    }
    page.visits++
    page.firstAt = Math.min(page.firstAt, row.at)
    page.lastAt = Math.max(page.lastAt, row.at)
    if (page.title === '') page.title = row.title
  }
  return [...pages.values()]
}

// Second-level labels under country domains that act like top-level domains (example.co.uk).
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or', 'go'])

/** The registrable domain, approximately: `en.wikipedia.org` → `wikipedia.org`. */
export function registrableDomain(host: string): string {
  const name = host.replace(/^www\./, '')
  if (/^[\d.]+$/.test(name) || name.startsWith('[')) return name
  const labels = name.split('.')
  if (labels.length <= 2) return name
  const tld = labels[labels.length - 1]!
  const second = labels[labels.length - 2]!
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2
  return labels.slice(-keep).join('.')
}

/** `wikipedia.org` → `wikipedia`, `bbc.co.uk` → `bbc`; an address of digits stays whole. */
export const domainLabel = (domain: string) =>
  /^[\d.]+$/.test(domain) ? domain : (domain.split('.')[0] ?? domain)

function locate(url: string): { domain: string; segment: string } | null {
  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/')[1] ?? ''
    return { domain: registrableDomain(parsed.hostname), segment: segment.toLowerCase() }
  } catch {
    return null
  }
}

const bySize = (a: ImportGroup, b: ImportGroup) =>
  b.pages.length - a.pages.length ||
  Math.max(...b.pages.map((p) => p.lastAt)) - Math.max(...a.pages.map((p) => p.lastAt))

/**
 * Groups pages by site (registrable domain); a site with more than SPLIT_ABOVE pages is split by
 * the first part of its path. Groups of at least two pages are kept, largest first, up to
 * MAX_GROUPS; everything else is a leftover.
 */
export function groupByAddress(
  pages: ImportPage[],
  maxGroups: number = MAX_GROUPS,
): AddressGrouping {
  const sites = new Map<string, ImportPage[]>()
  const leftovers: ImportPage[] = []
  for (const page of pages) {
    const place = locate(page.url)
    if (!place) leftovers.push(page)
    else (sites.get(place.domain) ?? sites.set(place.domain, []).get(place.domain)!).push(page)
  }

  const candidates: ImportGroup[] = []
  for (const [domain, members] of sites) {
    const label = domainLabel(domain)
    const parts = new Map<string, ImportPage[]>()
    if (members.length > SPLIT_ABOVE) {
      for (const page of members) {
        const segment = locate(page.url)!.segment
        if (segment !== '') (parts.get(segment) ?? parts.set(segment, []).get(segment)!).push(page)
      }
    }
    const split = new Set<ImportPage>()
    for (const [segment, part] of parts) {
      if (part.length < SPLIT_MIN) continue
      part.forEach((page) => split.add(page))
      candidates.push({ label: `${label}-${segment}`, pages: part })
    }
    candidates.push({ label, pages: members.filter((page) => !split.has(page)) })
  }

  const kept: ImportGroup[] = []
  for (const group of candidates.sort(bySize)) {
    if (group.pages.length >= 2 && kept.length < maxGroups) kept.push(group)
    else leftovers.push(...group.pages)
  }
  return { groups: kept, leftovers }
}

const WORD = /[\p{L}\p{N}]{4,}/gu

function wordsOf(page: ImportPage): Set<string> {
  let text = page.title
  try {
    const url = new URL(page.url)
    text += ` ${url.hostname.replace(/^www\./, '')} ${decodeURIComponent(url.pathname).replace(/[-_.]/g, ' ')}`
  } catch {
    // Title words only.
  }
  return new Set(text.toLowerCase().match(WORD) ?? [])
}

/**
 * Adds each leftover to the group it shares the most distinctive words with (title and address
 * words of four letters or more that most pages don't have); at least two shared words are
 * needed. Returns the pages that fit no group. Mutates `groups`.
 */
export function placeLeftovers(
  groups: ImportGroup[],
  leftovers: ImportPage[],
  everything: ImportPage[],
): ImportPage[] {
  if (groups.length === 0 || leftovers.length === 0) return leftovers
  const frequency = new Map<string, number>()
  const words = new Map<ImportPage, Set<string>>()
  for (const page of everything) {
    const set = wordsOf(page)
    words.set(page, set)
    set.forEach((word) => frequency.set(word, (frequency.get(word) ?? 0) + 1))
  }
  const common = Math.max(2, everything.length * 0.2)
  const distinctive = (page: ImportPage) =>
    [...(words.get(page) ?? wordsOf(page))].filter((word) => (frequency.get(word) ?? 0) <= common)
  const profiles = groups.map((group) => new Set(group.pages.flatMap(distinctive)))

  const unplaced: ImportPage[] = []
  for (const page of leftovers) {
    const mine = distinctive(page)
    let best = -1
    let bestShared = 1
    profiles.forEach((profile, index) => {
      const shared = mine.filter((word) => profile.has(word)).length
      if (shared > bestShared) {
        best = index
        bestShared = shared
      }
    })
    if (best < 0) unplaced.push(page)
    else {
      groups[best]!.pages.push(page)
      distinctive(page).forEach((word) => profiles[best]!.add(word))
    }
  }
  return unplaced
}

/** The newest MAX_GROUP_PAGES pages, oldest first: the order of a stack's chain. */
export function chainOrder(pages: ImportPage[]): ImportPage[] {
  return [...pages]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, MAX_GROUP_PAGES)
    .sort((a, b) => a.firstAt - b.firstAt)
}
