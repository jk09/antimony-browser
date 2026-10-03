import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Prompt, type Compose } from './Prompt'

type Entry = Parameters<Compose['onSend']>[0]

/** How long the card takes to fly into the sidebar; the stylesheet's transition matches. */
export const FLIGHT_MS = 380

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Where the page is, in window coordinates: the page area the page view is laid over. */
function pageRect(): DOMRect | null {
  return document.querySelector('.page-area')?.getBoundingClientRect() ?? null
}

/**
 * The field-of-view prompt: the sidebar's prompt, as a card over the middle of the page, where
 * the user is looking. The page view sits above the chrome UI, so it is hidden while this is open
 * and `snapshot` (its last picture) takes its place. Entering something flies the card into the
 * sidebar prompt, which then runs it (`onSend`); closing it any other way runs nothing (`onClose`).
 */
export function FieldOfView({
  snapshot,
  onFly,
  onSend,
  onClose,
}: {
  snapshot: string | null
  /** The card is about to fly: the sidebar has to be shown for it to land on. */
  onFly: () => void
  /** The card has landed; the sidebar prompt runs the entry. */
  onSend: (entry: Entry) => void
  onClose: () => void
}) {
  const [rect, setRect] = useState(pageRect)
  const [flying, setFlying] = useState<Entry | null>(null)
  const [target, setTarget] = useState<CSSProperties | undefined>()
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => setRect(pageRect())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Once the sidebar is shown, measure where its prompt is and fly the card there; without
  // somewhere to land (or with reduced motion) the entry is handed over at once.
  useLayoutEffect(() => {
    if (!flying) return
    const from = card.current?.getBoundingClientRect()
    const to = document.querySelector('.assistant-panel .prompt-card')?.getBoundingClientRect()
    if (!from || !to || from.width === 0 || to.width === 0 || reducedMotion()) {
      onSend(flying)
      return
    }
    const dx = to.left + to.width / 2 - (from.left + from.width / 2)
    const dy = to.top + to.height / 2 - (from.top + from.height / 2)
    setTarget({ transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width})` })
    const timer = setTimeout(() => onSend(flying), FLIGHT_MS + 40)
    return () => clearTimeout(timer)
  }, [flying, onSend])

  const compose: Compose = {
    onSend: (entry) => {
      if (flying) return
      onFly()
      setFlying(entry)
    },
    onEscape: onClose,
  }

  const style: CSSProperties = rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : { inset: 0 }
  return (
    <div
      className={`fov${flying ? ' flying' : ''}`}
      role="dialog"
      aria-label="Field of view prompt"
      style={style}
      onPointerDown={(event) => {
        if (!flying && !card.current?.contains(event.target as Node)) onClose()
      }}
    >
      {snapshot && <img className="fov-page" src={snapshot} alt="" draggable={false} />}
      <div className="fov-dim" />
      <div ref={card} className="fov-card" style={target}>
        <Prompt compose={compose} />
      </div>
    </div>
  )
}
