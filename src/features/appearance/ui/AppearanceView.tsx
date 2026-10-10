import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { OpenRequest } from '../ipc'
import { ThemePicker } from './ThemePicker'

/**
 * The appearance page over the page area (the page view is hidden meanwhile), opened by
 * /settings theme or File → Appearance…; × or Escape closes it.
 */
export function AppearanceView() {
  const api = window.antimony
  const [request, setRequest] = useState<(OpenRequest & { id: number }) | null>(null)
  const view = useRef<HTMLElement>(null)
  const next = useRef(0)

  useEffect(
    () => api.appearance.onOpen((opened) => setRequest({ ...opened, id: ++next.current })),
    [api],
  )
  useEffect(() => {
    if (request) view.current?.focus()
  }, [request])

  if (!request) return null
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setRequest(null)
    }
  }
  return (
    <section
      ref={view}
      className="appearance-view"
      aria-label="Appearance"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="appearance-header">
        <h2>Theme</h2>
        <button
          type="button"
          className="assistant-hide"
          aria-label="Close appearance"
          onClick={() => setRequest(null)}
        >
          ×
        </button>
      </header>
      <ThemePicker
        key={request.id}
        initialDescription={request.description}
        autoStart={request.description !== ''}
      />
    </section>
  )
}
