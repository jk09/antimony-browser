// Pure address parsing, used by the main process (validation, navigation guard) and the UI.

const localHost = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-f:.]+\])$/i

/** True for the only URLs web pages may be loaded from. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Turns what the user typed into an http(s) URL, or null if it isn't a web address.
 * Full URLs are kept, bare hosts get `https://` (`http://` for localhost and IP addresses).
 */
export function toUrl(input: string): string | null {
  const text = input.trim()
  if (text === '' || /\s/.test(text)) return null

  if (text.includes('://')) return isWebUrl(text) ? new URL(text).href : null
  // Another scheme (`mailto:`, `javascript:`, `about:`); `host:8080` has digits after the colon.
  if (/^[a-z][a-z\d+.-]*:(?!\d)/i.test(text)) return null

  let url: URL
  try {
    url = new URL(`https://${text}`)
  } catch {
    return null
  }
  if (localHost.test(url.hostname)) {
    url.protocol = 'http:'
    return url.href
  }
  return url.hostname.includes('.') ? url.href : null
}
