import { themeProperties, type Theme } from '../shared/theme'

/** Every custom property a theme may set, so the system default can remove them all. */
let applied: string[] = []

/**
 * Applies a theme to the chrome UI as inline custom properties on the root element (they win over
 * the stylesheet's light and dark palettes), or restores the system default with null.
 */
export function applyTheme(theme: Theme | null, root: HTMLElement = document.documentElement) {
  for (const name of applied) root.style.removeProperty(name)
  applied = []
  if (!theme) {
    root.style.removeProperty('color-scheme')
    delete root.dataset['theme']
    return
  }
  for (const [name, value] of Object.entries(themeProperties(theme))) {
    root.style.setProperty(name, value)
    applied.push(name)
  }
  root.style.setProperty('color-scheme', theme.scheme)
  root.dataset['theme'] = theme.name
}

/** Resolves after the next two frames, so a style change has been painted. */
export const painted = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
