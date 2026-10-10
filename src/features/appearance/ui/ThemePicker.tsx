import { useCallback, useEffect, useRef, useState } from 'react'
import { themeNeeds, type CheckedTheme, type Theme } from '../ipc'
import { applyTheme, painted } from './apply'

interface Candidate extends CheckedTheme {
  screenshot: string | null
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'capturing'; index: number; total: number }
  | { kind: 'done'; candidates: Candidate[] }
  | { kind: 'error'; message: string }

/** What the window shows while each candidate is captured: readable sample UI. */
function SampleScene() {
  return (
    <div className="theme-sample" aria-hidden="true">
      <h3>Reading in your theme</h3>
      <p>
        Body text the way pages, notes and answers appear. A <a href="#sample">link</a> and{' '}
        <span className="theme-sample-muted">secondary text</span> sit beside it.
      </p>
      <pre>
        <code>/settings theme</code>
      </pre>
      <input readOnly value="A text field" aria-hidden="true" tabIndex={-1} />
      <div className="theme-sample-row">
        <button type="button" className="primary" tabIndex={-1}>
          Primary
        </button>
        <button type="button" tabIndex={-1}>
          Secondary
        </button>
        <span className="theme-sample-ok">✓ Saved</span>
        <span className="theme-sample-error">✗ Couldn&rsquo;t load</span>
      </div>
    </div>
  )
}

/**
 * Themes for a usability need: the model proposes candidates (checked against WCAG 2.2 AA in main),
 * each is applied in turn and the window captured, and the screenshots are shown to pick from.
 * Picking applies and stores the theme. Used on the welcome page and the appearance page.
 */
export function ThemePicker({
  initialDescription = '',
  autoStart = false,
}: {
  initialDescription?: string
  autoStart?: boolean
}) {
  const api = window.antimony
  const [description, setDescription] = useState(initialDescription)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [current, setCurrent] = useState<Theme | null>(null)
  const started = useRef(false)

  useEffect(() => {
    api.appearance
      .get()
      .then(setCurrent)
      .catch((reason: unknown) => console.error(reason))
    return api.appearance.onChanged(setCurrent)
  }, [api])

  const run = useCallback(
    async (need: string) => {
      setPhase({ kind: 'generating' })
      let checked: CheckedTheme[]
      try {
        checked = await api.appearance.generate(need)
      } catch (reason) {
        setPhase({
          kind: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
        })
        return
      }
      const stored = await api.appearance.get().catch(() => null)
      const candidates: Candidate[] = []
      try {
        for (const [index, candidate] of checked.entries()) {
          setPhase({ kind: 'capturing', index, total: checked.length })
          applyTheme(candidate.theme)
          await painted()
          candidates.push({ ...candidate, screenshot: await api.appearance.capture() })
        }
      } catch (reason) {
        setPhase({
          kind: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
        })
        return
      } finally {
        // Never leave a candidate applied: back to what is stored.
        applyTheme(stored)
      }
      setPhase({ kind: 'done', candidates })
    },
    [api],
  )

  useEffect(() => {
    if (autoStart && !started.current && initialDescription.trim()) {
      started.current = true
      void run(initialDescription.trim())
    }
  }, [autoStart, initialDescription, run])

  const busy = phase.kind === 'generating' || phase.kind === 'capturing'
  const choose = (theme: Theme | null) => {
    api.appearance
      .set(theme)
      .then(setCurrent)
      .catch((reason: unknown) =>
        setPhase({
          kind: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
        }),
      )
  }

  if (phase.kind === 'capturing') {
    return (
      <div className="theme-picker">
        <p role="status">
          Taking screenshot {phase.index + 1} of {phase.total}…
        </p>
        <SampleScene />
      </div>
    )
  }

  return (
    <div className="theme-picker">
      <form
        className="theme-ask"
        onSubmit={(event) => {
          event.preventDefault()
          if (description.trim() && !busy) void run(description.trim())
        }}
      >
        <label htmlFor="theme-need">Describe what you need</label>
        <div className="theme-ask-row">
          <input
            id="theme-need"
            value={description}
            maxLength={300}
            placeholder="e.g. a light theme suitable for astigmatism"
            onChange={(event) => setDescription(event.target.value)}
          />
          <button type="submit" className="primary" disabled={busy || !description.trim()}>
            Show themes
          </button>
        </div>
        <div className="theme-needs" aria-label="Suggestions">
          {themeNeeds.map((need) => (
            <button
              key={need.name}
              type="button"
              disabled={busy}
              onClick={() => {
                setDescription(need.description)
                void run(need.description)
              }}
            >
              {need.label}
            </button>
          ))}
        </div>
      </form>
      <p className="theme-current">
        Current: {current ? current.name : 'system default'}
        {current && (
          <button type="button" onClick={() => choose(null)}>
            Use system default
          </button>
        )}
      </p>
      {phase.kind === 'generating' && (
        <p role="status">Asking the model for themes that meet WCAG 2.2 AA…</p>
      )}
      {phase.kind === 'error' && (
        <div className="theme-error" role="alert">
          <p>{phase.message}</p>
          <button type="button" onClick={() => description.trim() && void run(description.trim())}>
            Try again
          </button>
        </div>
      )}
      {phase.kind === 'done' && (
        <div className="theme-gallery" role="radiogroup" aria-label="Themes">
          {phase.candidates.map(({ theme, minTextContrast, screenshot }) => {
            const selected = current?.name === theme.name
            const summary = `${theme.scheme} · lowest text contrast ${minTextContrast.toFixed(1)}:1`
            return (
              <button
                key={theme.name}
                type="button"
                role="radio"
                aria-checked={selected}
                className="theme-card"
                onClick={() => choose(theme)}
              >
                {screenshot ? (
                  <img src={screenshot} alt={`The browser in ${theme.name}, ${summary}`} />
                ) : (
                  <span className="theme-noshot">No screenshot</span>
                )}
                <strong>{theme.name}</strong>
                <span>{theme.rationale}</span>
                <span className="theme-summary">{summary}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
