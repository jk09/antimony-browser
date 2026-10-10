import { useEffect } from 'react'
import { applyTheme } from './apply'

/** Applies the stored theme at start and whenever it changes. Renders nothing. */
export function ThemeApplier() {
  const api = window.antimony
  useEffect(() => {
    api.appearance
      .get()
      .then(applyTheme)
      .catch((reason: unknown) => console.error(reason))
    return api.appearance.onChanged(applyTheme)
  }, [api])
  return null
}
