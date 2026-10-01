import { useEffect, useRef, type ReactNode } from 'react'
import type { PageInsets } from '../ipc'

/**
 * Marks where the page view goes: main lays the page out over this element's box, so the chrome
 * UI's layout (assistant panel, debug panel) decides the page size, at any zoom of the chrome UI. Children show until a page loads.
 */
export function PageArea({ children }: { children?: ReactNode }) {
  const area = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = area.current
    if (!element) return
    let last = ''
    const report = () => {
      const rect = element.getBoundingClientRect()
      const insets: PageInsets = {
        top: Math.max(0, rect.top),
        right: Math.max(0, window.innerWidth - rect.right),
        bottom: Math.max(0, window.innerHeight - rect.bottom),
        left: Math.max(0, rect.left),
      }
      // A zoom of the chrome UI changes devicePixelRatio but not always the insets; main scales
      // them by the zoom factor, so it needs them again.
      const key = JSON.stringify([insets, window.devicePixelRatio])
      if (key === last) return
      last = key
      window.antimony.navigation.setInsets(insets).catch((reason: unknown) => console.error(reason))
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [])

  return (
    <main ref={area} className="page-area" data-testid="content">
      {children}
    </main>
  )
}
