import { useEffect, useState, type PointerEvent } from 'react'
import type { DebugEvent, DebugRun } from '../ipc'

export const MIN_WIDTH = 280
export const MAX_WIDTH = 800
const DEFAULT_WIDTH = 420
const MAX_RUNS = 20

/** Adds a live event to its run (creating the run on its first event), newest run first. */
export function addEvent(runs: DebugRun[], event: DebugEvent, label: string): DebugRun[] {
  const existing = runs.find((run) => run.id === event.runId)
  if (existing) {
    return runs.map((run) =>
      run.id === event.runId ? { ...run, events: [...run.events, event] } : run,
    )
  }
  return [
    { id: event.runId, label, startedAt: Date.now() - event.at, events: [event] },
    ...runs,
  ].slice(0, MAX_RUNS)
}

/** Copies text without the clipboard permission (the chrome UI is denied every permission). */
function copyText(text: string) {
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

function EventRow({ event }: { event: DebugEvent }) {
  return (
    <li className={`debug-event debug-event-${event.type}`}>
      <details>
        <summary>
          <span className="debug-type">{event.type}</span>
          <span className="debug-title">{event.title}</span>
          <span className="debug-time">
            +{event.at} ms{event.durationMs !== undefined ? ` · ${event.durationMs} ms` : ''}
          </span>
        </summary>
        {event.image && <img className="debug-image" src={event.image} alt="Screenshot" />}
        <pre className="debug-json">{JSON.stringify(event.data, null, 2)}</pre>
      </details>
    </li>
  )
}

/**
 * The assistant debugger: every model request and response, tool call, approval and result of
 * each run, docked right of the page (the page view narrows), left of the assistant panel. Toggled
 * with Ctrl/Cmd+Shift+D or /debug.
 */
export function DebugPanel() {
  const [visible, setVisible] = useState(false)
  const [runs, setRuns] = useState<DebugRun[]>([])
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  useEffect(() => window.antimony.agent.onDebugToggled(() => setVisible((shown) => !shown)), [])
  useEffect(
    () =>
      window.antimony.agent.onDebugEvent((event, label) =>
        setRuns((current) => addEvent(current, event, label)),
      ),
    [],
  )
  useEffect(() => {
    if (!visible) return
    window.antimony.agent
      .debugLog()
      .then(setRuns)
      .catch((reason: unknown) => console.error(reason))
  }, [visible])

  if (!visible) return null

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget
    // Measured from the panel's own right edge: the assistant panel may sit to its right.
    const right = handle.parentElement?.getBoundingClientRect().right ?? window.innerWidth
    handle.setPointerCapture(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = right - moveEvent.clientX
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)))
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <aside className="debug-panel" aria-label="Assistant debugger" style={{ width }}>
      <div
        className="debug-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize debugger"
        onPointerDown={startResize}
      />
      <header className="debug-header">
        <h2>Assistant debugger</h2>
        <button
          type="button"
          aria-label="Close debugger"
          onClick={() => setVisible(false)}
          className="debug-close"
        >
          ×
        </button>
      </header>
      {runs.length === 0 ? (
        <p className="debug-empty">No runs yet. Ask something in the prompt (Ctrl+L).</p>
      ) : (
        <ol className="debug-runs">
          {runs.map((run, index) => (
            <li key={run.id} className="debug-run">
              <details open={index === 0}>
                <summary>
                  <span className="debug-run-label">
                    #{run.id} {run.label}
                  </span>
                  <span className="debug-time">{run.events.length} events</span>
                </summary>
                <button
                  type="button"
                  className="debug-copy"
                  onClick={() => copyText(JSON.stringify(run, null, 2))}
                >
                  Copy run as JSON
                </button>
                <ol className="debug-events">
                  {run.events.map((event) => (
                    <EventRow key={event.seq} event={event} />
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
