import { useState } from 'react'
import { describeResult, type ImportResult } from '../ipc'

type Outcome =
  | { state: 'idle' }
  | { state: 'running'; path: string }
  | { state: 'done'; path: string; result: ImportResult }
  | { state: 'failed'; path: string; error: string }

/**
 * Imports the browsing data exported from Edge: chooses the .csv file in a native dialog and shows
 * what was imported. Mounted by the welcome page's Import step (via a slot in `App.tsx`).
 */
export function ImportStep() {
  const api = window.antimony
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' })
  const running = outcome.state === 'running'

  const choose = async () => {
    try {
      const path = await api.import.choose()
      if (path === null) return
      setOutcome({ state: 'running', path })
      const result = await api.import.run(path)
      setOutcome({ state: 'done', path, result })
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason)
      setOutcome((current) => ({
        state: 'failed',
        path: current.state === 'idle' ? '' : current.path,
        // Electron prefixes the message of an error thrown in main.
        error: error.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''),
      }))
    }
  }

  return (
    <div className="import-step">
      <div className="welcome-choices">
        <button type="button" onClick={() => void choose()} disabled={running}>
          {outcome.state === 'idle' ? 'Choose file…' : 'Choose another file…'}
        </button>
      </div>
      <div role="status" aria-live="polite" className="import-status">
        {outcome.state === 'running' && <p>Importing {outcome.path}…</p>}
        {outcome.state === 'done' && (
          <>
            <p>{describeResult(outcome.result)}</p>
            <p className="welcome-note">{outcome.path}</p>
          </>
        )}
        {outcome.state === 'failed' && <p className="welcome-error">{outcome.error}</p>}
      </div>
    </div>
  )
}
