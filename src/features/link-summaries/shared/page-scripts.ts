/// <reference lib="dom" />
// Run in web pages (isolated world 1003), so they need DOM types even though main code imports them.
// Each script is self-contained: it is serialized with Function.prototype.toString and called with
// JSON arguments, so it must not reference anything outside its own body.

export interface ScanLimits {
  /** Characters of paragraph text the main content needs to count as a simple page. */
  minText: number
  /** More links than this in the main content: not a simple page (an index, a feed, an app). */
  maxLinks: number
  /** Distinct link targets returned at most. */
  maxTargets: number
}

export interface Scan {
  /** The page's address without its fragment. */
  url: string
  simple: boolean
  /** Distinct http(s) targets of the main content's links, without fragment, in document order. */
  targets: string[]
}

/** Decides whether the page is a simple, article-like document and collects its link targets. */
export function scanLinks(args: ScanLimits): Scan {
  const page = new URL(location.href)
  page.hash = ''
  const none: Scan = { url: page.href, simple: false, targets: [] }
  if (page.protocol !== 'http:' && page.protocol !== 'https:') return none
  const sensitive = Array.from(document.querySelectorAll('input')).some((input) => {
    const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase()
    return (
      input.type === 'password' ||
      /(^|\s)(cc-[a-z-]+|current-password|new-password)(\s|$)/.test(autocomplete)
    )
  })
  if (sensitive) return none
  const root =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.querySelector('[role="main"]') ??
    document.body
  if (!root) return none
  const aside = 'nav, header, footer, aside, [role="navigation"]'
  const inMain = (element: Element) => {
    const outer = element.closest(aside)
    return !outer || !root.contains(outer) || outer === root
  }
  let text = 0
  for (const block of Array.from(root.querySelectorAll('p, dd, blockquote'))) {
    if (inMain(block)) text += (block.textContent ?? '').replace(/\s+/g, ' ').trim().length
  }
  const links = Array.from(root.querySelectorAll('a[href]')).filter(inMain) as HTMLAnchorElement[]
  if (text < args.minText || links.length > args.maxLinks) return none
  const file =
    /\.(pdf|zip|gz|tgz|tar|7z|rar|png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|m4a|webm|ogg|wav|avi|mov|mkv|exe|dmg|msi|deb|rpm|apk|iso|docx?|xlsx?|pptx?|odt|csv|json|xml|epub)$/i
  const targets: string[] = []
  for (const link of links) {
    if (targets.length >= args.maxTargets) break
    if (link.hasAttribute('download')) continue
    let target: URL
    try {
      target = new URL(link.href)
    } catch {
      continue
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') continue
    target.hash = ''
    if (target.href === page.href || file.test(target.pathname)) continue
    if (!targets.includes(target.href)) targets.push(target.href)
  }
  return { url: page.href, simple: true, targets }
}

export interface LinkSummary {
  url: string
  title: string
  summary: string
}

/**
 * Marks the links whose target (without fragment) has a summary and shows that summary in a
 * tooltip on hover (after a delay) and keyboard focus. The tooltip lives in a closed shadow root,
 * so the page's own scripts can't read it. Calling it again adds summaries. Returns the number of
 * marked links.
 */
export function markLinks(args: { summaries: LinkSummary[]; delayMs: number }): number {
  type State = {
    summaries: Map<string, LinkSummary>
    style: HTMLStyleElement
    host: HTMLElement
    tooltip: HTMLElement
    abort: AbortController
  }
  const key = '__antimonyLinkSummaries'
  const scope = window as unknown as Record<string, State | undefined>
  const attribute = 'data-antimony-summary'
  const targetOf = (link: HTMLAnchorElement): string | null => {
    try {
      const target = new URL(link.href)
      target.hash = ''
      return target.href
    } catch {
      return null
    }
  }
  let state = scope[key]
  if (!state) {
    const style = document.createElement('style')
    style.setAttribute('data-antimony-link-summaries', '')
    style.textContent = `a[${attribute}] { text-decoration-line: underline; text-decoration-style: dotted; text-underline-offset: 0.2em; }
a[${attribute}]::after { content: "\\24D8"; font-size: 0.75em; margin-left: 0.15em; vertical-align: super; line-height: 0; text-decoration: none; display: inline-block; }`
    const host = document.createElement('div')
    host.setAttribute('data-antimony-link-summaries', '')
    host.style.cssText =
      'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;'
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = document.createElement('style')
    sheet.textContent = `.tip { position: fixed; box-sizing: border-box; max-width: 360px; padding: 8px 10px; border-radius: 6px;
  font: 13px/1.4 system-ui, sans-serif; color: #1d1f22; background: #fbfaf6; border: 1px solid #80858c;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.2); pointer-events: none; }
.tip[hidden] { display: none; }
.title { font-weight: 600; margin-bottom: 4px; }
.host { margin-top: 4px; color: #4f545a; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .tip { color: #ecebe8; background: #24262a; border-color: #8a8f96; }
  .host { color: #b4b8be; }
}`
    const tooltip = document.createElement('div')
    tooltip.className = 'tip'
    tooltip.setAttribute('role', 'tooltip')
    tooltip.setAttribute('aria-live', 'polite')
    tooltip.hidden = true
    shadow.append(sheet, tooltip)
    ;(document.head ?? document.documentElement).append(style)
    document.documentElement.append(host)
    const created: State = {
      summaries: new Map(),
      style,
      host,
      tooltip,
      abort: new AbortController(),
    }
    state = created
    scope[key] = created
    let timer: ReturnType<typeof setTimeout> | null = null
    let shown: HTMLAnchorElement | null = null
    const marked = (target: EventTarget | null): HTMLAnchorElement | null =>
      target instanceof Element
        ? (target.closest(`a[${attribute}]`) as HTMLAnchorElement | null)
        : null
    const hide = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      shown = null
      tooltip.hidden = true
    }
    const show = (link: HTMLAnchorElement) => {
      const target = targetOf(link)
      const entry = target === null ? undefined : created.summaries.get(target)
      if (!entry) return
      shown = link
      const title = document.createElement('div')
      title.className = 'title'
      title.textContent = entry.title || target
      const summary = document.createElement('div')
      summary.textContent = entry.summary
      const site = document.createElement('div')
      site.className = 'host'
      site.textContent = new URL(entry.url).host
      tooltip.replaceChildren(title, summary, site)
      tooltip.hidden = false
      const rect = link.getBoundingClientRect()
      const width = tooltip.offsetWidth
      const height = tooltip.offsetHeight
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      const below = rect.bottom + 6
      const top = below + height > window.innerHeight - 8 ? rect.top - height - 6 : below
      tooltip.style.left = `${Math.round(left)}px`
      tooltip.style.top = `${Math.round(Math.max(8, top))}px`
    }
    const options = { capture: true, signal: created.abort.signal }
    document.addEventListener(
      'mouseover',
      (event) => {
        const link = marked(event.target)
        if (!link || link === shown) return
        hide()
        timer = setTimeout(() => show(link), args.delayMs)
      },
      options,
    )
    document.addEventListener(
      'mouseout',
      (event) => {
        const link = marked(event.target)
        if (link && !link.contains(event.relatedTarget as Node | null)) hide()
      },
      options,
    )
    document.addEventListener(
      'focusin',
      (event) => {
        const link = marked(event.target)
        if (link) {
          hide()
          show(link)
        }
      },
      options,
    )
    document.addEventListener('focusout', hide, options)
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') hide()
      },
      options,
    )
    window.addEventListener('scroll', hide, options)
  }
  for (const summary of args.summaries) state.summaries.set(summary.url, summary)
  let count = 0
  for (const link of Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
    const target = targetOf(link)
    if (target !== null && state.summaries.has(target)) {
      link.setAttribute(attribute, '')
      count++
    }
  }
  return count
}

/** Removes every mark, the stylesheet, the tooltip and its listeners that markLinks added. */
export function unmarkLinks(): void {
  const key = '__antimonyLinkSummaries'
  const scope = window as unknown as Record<
    string,
    { style: Element; host: Element; abort: AbortController } | undefined
  >
  const state = scope[key]
  for (const link of Array.from(document.querySelectorAll('a[data-antimony-summary]'))) {
    link.removeAttribute('data-antimony-summary')
  }
  if (!state) return
  state.abort.abort()
  state.style.remove()
  state.host.remove()
  delete scope[key]
}

/** The JavaScript source that calls `script` with `args` (JSON only), for executeJavaScript. */
export function scriptSource<A>(script: (args: A) => unknown, args: A): string {
  return `(${script.toString()})(${JSON.stringify(args)})`
}
