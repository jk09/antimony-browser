// Decides, without any network call, what a submitted prompt means.

export type Classified =
  | { kind: 'empty' }
  /** `/name rest…`; name is '' when the text after / isn't a valid command name. */
  | { kind: 'command'; name: string; args: string }
  | { kind: 'url'; url: string }
  | { kind: 'query'; text: string }

export interface ClassifyOptions {
  hasAttachments: boolean
  /** navigation's parser: typed text → http(s) URL or null. */
  toUrl: (text: string) => string | null
}

/**
 * In order: `/command`, `?` forces a model query, URL-like text (without attachments) navigates,
 * everything else goes to the model.
 */
export function classify(input: string, { hasAttachments, toUrl }: ClassifyOptions): Classified {
  const text = input.trim()
  if (!text && !hasAttachments) return { kind: 'empty' }
  if (text.startsWith('/')) {
    const match = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(text)
    return match
      ? { kind: 'command', name: match[1]!.toLowerCase(), args: (match[2] ?? '').trim() }
      : { kind: 'command', name: '', args: text.slice(1).trim() }
  }
  if (text.startsWith('?')) return { kind: 'query', text: text.slice(1).trim() }
  if (!hasAttachments) {
    const url = toUrl(text)
    if (url !== null) return { kind: 'url', url }
  }
  return { kind: 'query', text }
}
