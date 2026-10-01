/// <reference lib="dom" />
// Runs in web pages (isolated world), so it needs DOM types even though main code imports it.

export interface PageMeta {
  title: string
  description: string | null
  siteName: string | null
  ogType: string | null
  imageUrl: string | null
  keywords: string | null
  author: string | null
  publishedAt: string | null
  lang: string | null
  contentType: string | null
  contentLanguage: string | null
  /** `document.lastModified` when the server sent Last-Modified (else Chromium reports "now"). */
  lastModified: string | null
  canonicalLink: string | null
  /** Visible text; '' for sensitive pages. */
  text: string
  /** The page shows a password or payment card field: no text, screenshot or summary is kept. */
  sensitive: boolean
}

/**
 * Header metadata and visible text of the page. Self-contained: it is serialized with
 * Function.prototype.toString and called with JSON arguments, so it must not reference anything
 * outside its own body.
 */
export function readPageMeta(args: { maxText: number; maxField: number }): PageMeta {
  const clip = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? '').replace(/\s+/g, ' ').trim()
    return trimmed ? trimmed.slice(0, args.maxField) : null
  }
  const meta = (...names: string[]): string | null => {
    for (const name of names) {
      const element = document.querySelector(
        `meta[name="${name}" i], meta[property="${name}" i], meta[http-equiv="${name}" i]`,
      )
      const content = clip(element?.getAttribute('content'))
      if (content) return content
    }
    return null
  }
  const link = document.querySelector('link[rel~="canonical" i]')
  const sensitive = Array.from(document.querySelectorAll('input')).some((input) => {
    const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase()
    return (
      input.type === 'password' ||
      /(^|\s)(cc-[a-z-]+|current-password|new-password)(\s|$)/.test(autocomplete)
    )
  })
  // Without a Last-Modified header Chromium reports the current time.
  const modified = new Date(document.lastModified)
  const lastModified =
    !Number.isNaN(modified.getTime()) && Date.now() - modified.getTime() > 60_000
      ? modified.toISOString()
      : null
  const text = sensitive ? '' : (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim()
  return {
    title: clip(document.title) ?? '',
    description: meta('description', 'og:description', 'twitter:description'),
    siteName: meta('og:site_name', 'application-name'),
    ogType: meta('og:type'),
    imageUrl: meta('og:image', 'twitter:image'),
    keywords: meta('keywords', 'news_keywords'),
    author: meta('author', 'article:author'),
    publishedAt: meta('article:published_time', 'date', 'dc.date'),
    lang: clip(document.documentElement.lang),
    contentType: clip(document.contentType),
    contentLanguage: meta('content-language'),
    lastModified,
    canonicalLink: clip(link?.getAttribute('href')),
    text: text.slice(0, args.maxText),
    sensitive,
  }
}

/** JavaScript that calls `script` with `args` (both must be self-contained / JSON). */
export function scriptSource<A>(script: (args: A) => unknown, args: A): string {
  return `(${script.toString()})(${JSON.stringify(args)})`
}
