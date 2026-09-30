/** True if `url` is the chrome UI's own document, the only place the chrome UI may navigate to. */
export function isChromeUiUrl(url: string, chromeUiUrl: string): boolean {
  let target: URL
  let home: URL
  try {
    target = new URL(url)
    home = new URL(chromeUiUrl)
  } catch {
    return false
  }
  if (home.protocol === 'file:') {
    return target.protocol === 'file:' && target.pathname === home.pathname
  }
  return target.origin === home.origin
}
