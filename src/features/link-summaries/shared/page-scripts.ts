/// <reference lib="dom" />
// Runs in web pages (isolated world 1003), so it needs DOM types even though main code imports it.
// Self-contained: it is serialized with Function.prototype.toString and called with JSON
// arguments, so it must not reference anything outside its own body. It only reads the page.

export interface PageLinks {
  /** The page's address without its fragment. */
  url: string
  /** Distinct http(s) targets of the main text's links, without fragment, in document order. */
  links: { url: string; text: string }[]
}

/** The links of the page's main content (not navigation, header, footer or asides). */
export function collectLinks(args: { maxLinks: number; maxText: number }): PageLinks {
  const page = new URL(location.href)
  page.hash = ''
  const found: PageLinks = { url: page.href, links: [] }
  if (page.protocol !== 'http:' && page.protocol !== 'https:') return found
  const root =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.querySelector('[role="main"]') ??
    document.body
  if (!root) return found
  const aside = 'nav, header, footer, aside, [role="navigation"]'
  const inMain = (element: Element) => {
    const outer = element.closest(aside)
    return !outer || !root.contains(outer) || outer === root
  }
  const file =
    /\.(pdf|zip|gz|tgz|tar|7z|rar|png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|m4a|webm|ogg|wav|avi|mov|mkv|exe|dmg|msi|deb|rpm|apk|iso|docx?|xlsx?|pptx?|odt|csv|json|xml|epub)$/i
  const seen = new Set<string>()
  for (const link of Array.from(root.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
    if (found.links.length >= args.maxLinks) break
    if (!inMain(link) || link.hasAttribute('download')) continue
    let target: URL
    try {
      target = new URL(link.href)
    } catch {
      continue
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') continue
    target.hash = ''
    if (target.href === page.href || file.test(target.pathname) || seen.has(target.href)) continue
    seen.add(target.href)
    const text = (link.textContent ?? '').replace(/\s+/g, ' ').trim()
    found.links.push({ url: target.href, text: text.slice(0, args.maxText) })
  }
  return found
}

/** The JavaScript source that calls `script` with `args` (JSON only), for executeJavaScript. */
export function scriptSource<A>(script: (args: A) => unknown, args: A): string {
  return `(${script.toString()})(${JSON.stringify(args)})`
}
