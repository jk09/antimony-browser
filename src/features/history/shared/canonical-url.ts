// One canonical form per page, so a page visited through tracking links, reordered parameters or
// fragment jumps is still one row in history.

/** Longest canonical URL history stores; longer ones are usually generated state, not pages. */
export const MAX_URL_LENGTH = 2048

/** Query parameters that only track the click; dropped everywhere. */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'yclid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'oly_anon_id',
  'oly_enc_id',
  'vero_id',
  'ref_src',
  'ref_url',
  'spm',
])

/** Parameters that track only on some sites (elsewhere they may carry meaning). */
const SITE_TRACKING_PARAMS: { hosts: string[]; params: string[] }[] = [
  { hosts: ['youtube.com', 'youtu.be', 'spotify.com'], params: ['si'] },
  { hosts: ['twitter.com', 'x.com'], params: ['s', 't'] },
]

const onSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`)

function isTracking(name: string, host: string): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) return true
  return SITE_TRACKING_PARAMS.some(
    ({ hosts, params }) => params.includes(lower) && hosts.some((site) => onSite(host, site)),
  )
}

/** `#/path` and `#!path` are routes in hash-routed single-page apps; other fragments are anchors. */
const isHashRoute = (hash: string) => /^#!?\//.test(hash) || hash.startsWith('#!')

/**
 * The canonical form of a visited http(s) URL, or null if history shouldn't store it: lowercase
 * scheme and host (punycode), no default port, no credentials, no tracking parameters, the rest
 * sorted by name, and no fragment unless it is a hash route. Path case and trailing slashes stay:
 * servers may treat them differently.
 */
export function canonicalUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  url.username = ''
  url.password = ''
  // WHATWG URL already lowercases the host, converts it to punycode and drops default ports.
  const host = url.hostname.replace(/^www\./, '')
  const kept = [...url.searchParams].filter(([name]) => !isTracking(name, host))
  // Stable sort: repeated parameters (a=1&a=2) keep their order.
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  url.search = kept.length ? new URLSearchParams(kept).toString() : ''
  if (!isHashRoute(url.hash)) url.hash = ''
  const result = url.href
  return result.length > MAX_URL_LENGTH ? null : result
}

/** Canonical URL without the scheme and a leading `www.`, for prefix matching what users type. */
export function bareUrl(canonical: string): string {
  return canonical.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
}

/** What the user typed, reduced the same way as `bareUrl`, for prefix matching. */
export function bareInput(typed: string): string {
  return typed
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
}

/** The host without a leading `www.`. */
export function hostOf(canonical: string): string {
  return new URL(canonical).hostname.replace(/^www\./, '')
}

// Second-level labels under country domains that act like top-level domains (example.co.uk).
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or', 'go'])

/**
 * The registrable domain, approximately (`en.wikipedia.org` → `wikipedia.org`,
 * `news.bbc.co.uk` → `bbc.co.uk`), so typing `wikipedia` matches subdomains too. IP addresses
 * and single-label hosts stay as they are.
 */
export function domainOf(host: string): string {
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return host
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const tld = labels[labels.length - 1]!
  const second = labels[labels.length - 2]!
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2
  return labels.slice(-keep).join('.')
}

/**
 * The page's `<link rel="canonical">` replaces `canonical` only if it is http(s), same origin,
 * same path, and differs only in the query or fragment (it strips a session id, say). Sites that
 * point every page at their home page, or at another host, don't merge pages that way.
 * Returns the new canonical URL, or null to keep the current one.
 */
export function adoptCanonicalLink(canonical: string, link: string | null): string | null {
  if (!link) return null
  let target: URL
  let current: URL
  try {
    current = new URL(canonical)
    target = new URL(link, canonical)
  } catch {
    return null
  }
  if (target.origin !== current.origin || target.pathname !== current.pathname) return null
  const adopted = canonicalUrl(target.href)
  return adopted !== null && adopted !== canonical ? adopted : null
}
