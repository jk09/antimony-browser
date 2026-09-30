/// <reference lib="dom" />
// These scripts run in web pages, so they need DOM types even though main code imports them.
// Fixed scripts the agent runs in the page's isolated world (never model-written code). Each one is
// self-contained: it is serialized with Function.prototype.toString and called with JSON arguments,
// so it must not reference anything outside its own body.

export interface PageElement {
  index: number
  role: string
  name: string
  selector: string
}

export interface PageSnapshot {
  title: string
  url: string
  text: string
  textTruncated: boolean
  elements: PageElement[]
  elementsTruncated: boolean
}

export interface ElementInfo {
  found: boolean
  error?: string
  tag?: string
  role?: string
  name?: string
  /** Password or payment card field: the agent never types into these. */
  sensitive?: boolean
  /** Center of the element in viewport coordinates, after scrolling it into view. */
  x?: number
  y?: number
}

export interface FindResult {
  total: number
  matches: string[]
}

export interface ScrollResult {
  scrollY: number
  scrollHeight: number
  viewportHeight: number
}

/** Title, URL, visible text and interactive elements (with a CSS selector each). */
export function readPage(args: { maxText: number; maxElements: number }): PageSnapshot {
  const cssIdent = (value: string) =>
    value.replace(/^(\d)/, '\\3$1 ').replace(/([^\w\u00a0-\uffff-]|^-(?=\d))/g, '\\$1')
  const unique = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1
    } catch {
      return false
    }
  }
  const selectorOf = (element: Element): string => {
    if (element.id && unique(`#${cssIdent(element.id)}`)) return `#${cssIdent(element.id)}`
    const tag = element.tagName.toLowerCase()
    const name = element.getAttribute('name')
    if (name && unique(`${tag}[name="${name.replace(/["\\]/g, '\\$&')}"]`)) {
      return `${tag}[name="${name.replace(/["\\]/g, '\\$&')}"]`
    }
    const parts: string[] = []
    let current: Element | null = element
    while (current && current !== document.documentElement) {
      if (current.id && unique(`#${cssIdent(current.id)}`)) {
        parts.unshift(`#${cssIdent(current.id)}`)
        break
      }
      const currentTag = current.tagName.toLowerCase()
      const parent: Element | null = current.parentElement
      if (!parent) {
        parts.unshift(currentTag)
        break
      }
      const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === current!.tagName,
      )
      parts.unshift(
        sameTag.length > 1
          ? `${currentTag}:nth-of-type(${sameTag.indexOf(current) + 1})`
          : currentTag,
      )
      current = parent
    }
    return parts.join(' > ')
  }
  const visible = (element: Element) => {
    const check = (element as Element & { checkVisibility?: (o?: object) => boolean })
      .checkVisibility
    if (typeof check === 'function' && !check.call(element, { visibilityProperty: true })) {
      return false
    }
    const rect = element.getBoundingClientRect()
    // jsdom has no layout (all zeros); real pages hide zero-size elements.
    const hasLayout = rect.width > 0 || rect.height > 0 || rect.top !== 0 || rect.left !== 0
    return hasLayout || document.body.getBoundingClientRect().width === 0
  }
  const roleOf = (element: Element) => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase()
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
      if (type === 'checkbox' || type === 'radio') return type
      return type === 'search' ? 'searchbox' : 'textbox'
    }
    if (tag === 'summary') return 'button'
    if ((element as HTMLElement).isContentEditable) return 'textbox'
    return 'button'
  }
  const nameOf = (element: Element) => {
    const html = element as HTMLInputElement
    const labels = html.labels
      ? Array.from(html.labels).map((label) => label.textContent ?? '')
      : []
    const candidates = [
      element.getAttribute('aria-label'),
      labels.join(' '),
      (element as HTMLElement).innerText ?? element.textContent,
      element.getAttribute('placeholder'),
      element.getAttribute('title'),
      element.getAttribute('alt'),
      html.type === 'submit' || html.type === 'button' ? html.value : null,
      element.getAttribute('name'),
    ]
    const name = candidates.map((c) => (c ?? '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
    return name.length > 80 ? `${name.slice(0, 79)}…` : name
  }

  const body = document.body as HTMLElement | null
  const rawText = body ? (body.innerText ?? body.textContent ?? '') : ''
  const text = rawText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

  const interactive = Array.from(
    document.querySelectorAll(
      'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=textbox], [role=checkbox], [role=tab], [role=menuitem], [contenteditable=""], [contenteditable=true]',
    ),
  ).filter((element) => !(element as HTMLInputElement).disabled && visible(element))

  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, args.maxText),
    textTruncated: text.length > args.maxText,
    elements: interactive.slice(0, args.maxElements).map((element, index) => ({
      index: index + 1,
      role: roleOf(element),
      name: nameOf(element),
      selector: selectorOf(element),
    })),
    elementsTruncated: interactive.length > args.maxElements,
  }
}

/** Case-insensitive search of the page text; returns snippets around the first matches. */
export function findInPage(args: { text: string; max: number }): FindResult {
  const body = document.body as HTMLElement | null
  const haystack = (body ? (body.innerText ?? body.textContent ?? '') : '').replace(/\s+/g, ' ')
  const needle = args.text.toLowerCase()
  const lower = haystack.toLowerCase()
  const matches: string[] = []
  let total = 0
  let from = 0
  while (needle && (from = lower.indexOf(needle, from)) !== -1) {
    total++
    if (matches.length < args.max) {
      const start = Math.max(0, from - 60)
      const end = Math.min(haystack.length, from + needle.length + 60)
      matches.push(
        `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`,
      )
    }
    from += needle.length
  }
  return { total, matches }
}

/** Finds the element for `selector`, scrolls it into view and describes it. */
export function inspectElement(args: { selector: string; focus: boolean }): ElementInfo {
  let element: Element | null
  try {
    element = document.querySelector(args.selector)
  } catch {
    return { found: false, error: 'Invalid CSS selector' }
  }
  if (!element) return { found: false, error: 'No element matches the selector' }
  const html = element as HTMLInputElement
  const type = (element.getAttribute('type') ?? '').toLowerCase()
  const roleOf = (target: Element) => {
    const tag = target.tagName.toLowerCase()
    const byTag: Record<string, string> = {
      a: 'link',
      select: 'combobox',
      textarea: 'textbox',
      summary: 'button',
    }
    if (target.getAttribute('role')) return target.getAttribute('role')!
    if (tag === 'input') {
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
      return type === 'checkbox' || type === 'radio' ? type : 'textbox'
    }
    return byTag[tag] ?? tag
  }
  const autocomplete = (element.getAttribute('autocomplete') ?? '').toLowerCase()
  const sensitive =
    type === 'password' ||
    /(^|\s)(cc-[a-z-]+|current-password|new-password)(\s|$)/.test(autocomplete)
  if (typeof html.scrollIntoView === 'function')
    html.scrollIntoView({ block: 'center', inline: 'center' })
  if (args.focus && !sensitive) {
    html.focus()
    if (typeof html.select === 'function') html.select()
  }
  const rect = element.getBoundingClientRect()
  const name = (
    element.getAttribute('aria-label') ||
    (html.innerText ?? element.textContent ?? '') ||
    element.getAttribute('placeholder') ||
    element.getAttribute('name') ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return {
    found: true,
    tag: element.tagName.toLowerCase(),
    role: roleOf(element),
    name,
    sensitive,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  }
}

/** Scrolls the page by most of a screen, or to the top or bottom. */
export function scrollPage(args: { direction: 'up' | 'down' | 'top' | 'bottom' }): ScrollResult {
  const step = Math.round(window.innerHeight * 0.8)
  const height = document.documentElement.scrollHeight
  if (args.direction === 'up') window.scrollBy(0, -step)
  else if (args.direction === 'down') window.scrollBy(0, step)
  else window.scrollTo(0, args.direction === 'top' ? 0 : height)
  return {
    scrollY: Math.round(window.scrollY),
    scrollHeight: height,
    viewportHeight: window.innerHeight,
  }
}

/** The JavaScript source that calls `script` with `args` (JSON only), for executeJavaScript. */
export function scriptSource<A>(script: (args: A) => unknown, args: A): string {
  return `(${script.toString()})(${JSON.stringify(args)})`
}
