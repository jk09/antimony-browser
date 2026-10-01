import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { AgentState } from '../../agent/ipc'
import type { NavigationState } from '../../navigation/ipc'
import { Prompt } from './Prompt'
import { useSubscription } from './useSubscription'

export const MIN_WIDTH = 300
export const MAX_WIDTH = 720
export const DEFAULT_WIDTH = 400
const KEY_STEP = 16

/** The panel width for a requested one: within the limits, rounded to whole pixels. */
export function clampWidth(requested: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, requested)))
}

/**
 * The assistant panel, docked on the right edge of the window: page title and URL, the
 * conversation filling the height, the skill form, and the prompt at the bottom. Its width only
 * changes when the user drags its edge, so the page view keeps its size while the conversation
 * grows. Ctrl/Cmd+L shows it and focuses the prompt, Ctrl/Cmd+B shows or hides it; it also shows itself for an approval or a
 * skill save.
 */
export function AssistantPanel({
  conversation,
  form,
  overlay,
}: {
  conversation?: ReactNode
  form?: ReactNode
  /** Laid over the conversation when it renders anything (history's view). */
  overlay?: ReactNode
}) {
  const api = window.antimony
  const [shown, setShown] = useState(true)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [focusRequest, setFocusRequest] = useState(0)
  const [navigation, setNavigation] = useState<NavigationState | null>(null)
  const agent = useSubscription<AgentState>(api.agent.state, api.agent.onStateChanged)

  useEffect(() => api.navigation.onStateChanged(setNavigation), [api])
  useEffect(
    () =>
      api.prompt.onOpen(() => {
        setShown(true)
        setFocusRequest((n) => n + 1)
      }),
    [api],
  )
  useEffect(() => api.skills.onSaveRequested(() => setShown(true)), [api])
  useEffect(() => api.history.onOpen(() => setShown(true)), [api])
  // An approval is asked in the conversation: show the panel, and keep it shown while pending.
  useEffect(
    () =>
      api.agent.onStateChanged((state) => {
        if (state.status === 'awaiting-approval') setShown(true)
      }),
    [api],
  )
  const pending = agent?.status === 'awaiting-approval'
  useEffect(
    () =>
      api.prompt.onToggle(() => {
        // While an approval is pending the panel stays shown.
        if (pending) return
        setShown(!shown)
        if (shown) void api.prompt.focusPage()
        else setFocusRequest((n) => n + 1)
      }),
    [api, shown, pending],
  )
  const visible = shown || pending

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget
    const right = handle.parentElement?.getBoundingClientRect().right ?? window.innerWidth
    handle.setPointerCapture(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent) =>
      setWidth(clampWidth(right - moveEvent.clientX))
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  // The handle is on the left edge: ← widens the panel, → narrows it.
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    setWidth((current) => clampWidth(current + delta))
  }

  const hasConversation = agent !== null && (agent.items.length > 0 || agent.approval !== null)
  const title = navigation?.title || navigation?.url

  return (
    <aside
      className="assistant-panel"
      aria-label="Assistant"
      hidden={!visible}
      style={{ flexBasis: width }}
    >
      <div
        className="assistant-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
      />
      <header className="assistant-header">
        <div className="assistant-page" data-testid="page-info">
          <span className="assistant-page-title">{title || 'New tab'}</span>
          {navigation?.title && <span className="assistant-page-url">{navigation.url}</span>}
        </div>
        <button
          type="button"
          className="assistant-hide"
          aria-label="Hide assistant"
          title="Hide (Ctrl+B)"
          onClick={() => setShown(false)}
        >
          ×
        </button>
      </header>
      <div className="assistant-body">
        {hasConversation && conversation}
        {overlay}
      </div>
      {form}
      <Prompt focusRequest={focusRequest} />
    </aside>
  )
}
