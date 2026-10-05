import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { AgentState } from '../../agent/ipc'
import type { NavigationState } from '../../navigation/ipc'
import { FieldOfView } from './FieldOfView'
import { Prompt, type Handoff } from './Prompt'
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
 * The assistant panel, docked on the right edge of the window: the header (stacks' tree, or the
 * page title and URL), the
 * conversation filling the height, and the prompt at the bottom. Its width only
 * changes when the user drags its edge, so the page view keeps its size while the conversation
 * grows. Ctrl/Cmd+L shows it and focuses the prompt, Ctrl/Cmd+B shows or hides it (it has no close button:
 * it is only ever hidden, never removed); it also shows itself for an approval.
 */
export function AssistantPanel({
  header,
  conversation,
  overlay,
}: {
  /** Replaces the page title and URL in the header (stacks' navigation tree). */
  header?: ReactNode
  conversation?: ReactNode
  /** Laid over the conversation when it renders anything (history's view). */
  overlay?: ReactNode
}) {
  const api = window.antimony
  const [shown, setShown] = useState(true)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [focusRequest, setFocusRequest] = useState(0)
  // The field of view: its page snapshot while open, and the last entry it handed to the prompt.
  const [fov, setFov] = useState<{ snapshot: string | null } | null>(null)
  const [handoff, setHandoff] = useState<Handoff | null>(null)
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
  // Ctrl/Cmd+I opens the field of view, and closes it again. Opening hides the page view.
  const fovOpen = useRef(false)
  const closeFov = useCallback(() => {
    if (!fovOpen.current) return
    fovOpen.current = false
    setFov(null)
    api.prompt.uncoverPage().catch((reason: unknown) => console.error(reason))
  }, [api])
  useEffect(
    () =>
      api.prompt.onFieldOfView(() => {
        if (fovOpen.current) {
          closeFov()
          return
        }
        fovOpen.current = true
        api.prompt
          .coverPage()
          .then((snapshot) => {
            // Closed again before the snapshot arrived: the page view is hidden now, show it.
            if (fovOpen.current) setFov({ snapshot })
            else void api.prompt.uncoverPage()
          })
          .catch((reason: unknown) => {
            console.error(reason)
            if (fovOpen.current) setFov({ snapshot: null })
          })
      }),
    [api, closeFov],
  )
  // Showing the sidebar prompt (Ctrl/Cmd+L, Ctrl/Cmd+Alt+I) closes the field of view.
  useEffect(() => api.prompt.onOpen(closeFov), [api, closeFov])
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
  // Read by the toggle listener, subscribed once: rapid toggles each see the latest state.
  const latest = useRef({ shown, pending })
  useLayoutEffect(() => {
    latest.current = { shown, pending }
  })
  useEffect(
    () =>
      api.prompt.onToggle(() => {
        const current = latest.current
        // While an approval is pending the panel stays shown.
        if (current.pending) return
        const next = !current.shown
        latest.current = { ...current, shown: next }
        setShown(next)
        if (next) setFocusRequest((n) => n + 1)
        else void api.prompt.focusPage()
      }),
    [api],
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
    <>
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
        <header className={`assistant-header${header ? ' custom' : ''}`}>
          {header ?? (
            <div className="assistant-page" data-testid="page-info">
              <span className="assistant-page-title">{title || 'New tab'}</span>
              {navigation?.title && <span className="assistant-page-url">{navigation.url}</span>}
            </div>
          )}
        </header>
        <div className="assistant-body">
          {hasConversation && conversation}
          {overlay}
        </div>
        <Prompt focusRequest={focusRequest} handoff={handoff} />
      </aside>
      {fov && (
        <FieldOfView
          snapshot={fov.snapshot}
          onFly={() => setShown(true)}
          onSend={(entry) => {
            setHandoff((last) => ({ id: (last?.id ?? 0) + 1, ...entry }))
            closeFov()
          }}
          onClose={() => {
            closeFov()
            void api.prompt.focusPage()
          }}
        />
      )}
    </>
  )
}
