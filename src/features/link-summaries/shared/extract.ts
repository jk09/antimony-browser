// The gist of a prefetched HTML document without a DOM (main has none): title, description and
// visible text. Approximate on purpose – the model only needs a few paragraphs.

export interface ExtractedPage {
  title: string
  description: string | null
  text: string
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED[name.toLowerCase()] ?? match
  })
}

const clean = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim()

/** The attributes of one start tag, names lower-cased. */
function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const match of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    found[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? ''
  }
  return found
}

export function extractPage(html: string, maxText: number): ExtractedPage {
  const meta: Record<string, string> = {}
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    const name = (attrs['name'] ?? attrs['property'] ?? '').toLowerCase()
    if (name && attrs['content'] && !(name in meta)) meta[name] = clean(attrs['content'])
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const title = (titleTag ? clean(titleTag) : '') || meta['og:title'] || ''
  const description = meta['description'] || meta['og:description'] || null
  const body = /<body\b[^>]*>([\s\S]*)/i.exec(html)?.[1] ?? html
  const text = clean(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(
        /<(script|style|noscript|template|svg|head|title|nav|header|footer|aside|form|select)\b[\s\S]*?<\/\1\s*>/gi,
        ' ',
      )
      .replace(/<[^>]*>/g, ' '),
  )
  return {
    title: title.slice(0, 300),
    description: description?.slice(0, 500) ?? null,
    text: text.slice(0, maxText),
  }
}
