import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  MAX_NOTE,
  SNIPPET_END,
  SNIPPET_START,
  type HistoryPage,
  type SearchMode,
  type SearchResult,
} from '../ipc'

const SEARCH_DELAY_MS = 200

/** "12 s", "4 min", "1 h 20 min". */
export function formatDwell(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '')

/** The snippet with matched words in <mark>. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(SNIPPET_START)
  return (
    <p className="history-snippet">
      {parts.map((part, index) => {
        if (index === 0) return part
        const [marked = '', rest = ''] = part.split(SNIPPET_END)
        return (
          <span key={index}>
            <mark>{marked}</mark>
            {rest}
          </span>
        )
      })}
    </p>
  )
}

function NoteEditor({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string
  label: string
  onSave: (note: string | null) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <form
      className="history-note-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(draft.trim() ? draft : null)
      }}
    >
      <textarea
        aria-label={label}
        value={draft}
        maxLength={MAX_NOTE}
        rows={3}
        autoFocus
        placeholder="What matters on this page? A note makes it a bookmark."
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            onSave(draft.trim() ? draft : null)
          }
        }}
      />
      <div className="history-note-buttons">
        <button type="submit">Save note</button>
        {initial && (
          <button type="button" onClick={() => onSave(null)}>
            Remove note
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function HistoryRow({ page, onChanged }: { page: HistoryPage; onChanged: () => void }) {
  const api = window.antimony
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!page.hasScreenshot) return
    let stale = false
    api.history
      .screenshot(page.id)
      .then((url) => {
        if (!stale) setThumbnail(url)
      })
      .catch((reason: unknown) => console.error(reason))
    return () => {
      stale = true
    }
  }, [api, page.id, page.hasScreenshot])

  const saveNote = (note: string | null) => {
    api.history
      .setNote(page.id, note)
      .then(() => {
        setEditing(false)
        onChanged()
      })
      .catch((reason: unknown) => console.error(reason))
  }

  const title = page.title || bare(page.url)
  return (
    <li className="history-row">
      <div className="history-thumb" aria-hidden="true">
        {thumbnail && <img src={thumbnail} alt="" />}
      </div>
      <div className="history-main">
        <button
          type="button"
          className="history-open"
          title={page.url}
          onClick={() => void api.navigation.go(page.url)}
        >
          {title}
        </button>
        <span className="history-meta">
          {bare(page.url)} · {new Date(page.lastVisitAt).toLocaleString()} ·{' '}
          {page.visitCount === 1 ? '1 visit' : `${page.visitCount} visits`}
          {page.dwellMs >= 1000 && ` · ${formatDwell(page.dwellMs)}`}
        </span>
        {page.note && !editing && <p className="history-note">📌 {page.note}</p>}
        {page.snippet ? (
          <Snippet text={page.snippet} />
        ) : (
          (page.summary ?? page.description) && (
            <p className="history-snippet">{page.summary ?? page.description}</p>
          )
        )}
        {editing ? (
          <NoteEditor
            initial={page.note ?? ''}
            label={`Note for ${title}`}
            onSave={saveNote}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="history-actions">
            <button type="button" onClick={() => setEditing(true)}>
              {page.note ? 'Edit note' : 'Add note'}
            </button>
            <button
              type="button"
              aria-label={`Delete ${title} from history`}
              onClick={() =>
                void api.history
                  .delete(page.id)
                  .then(onChanged)
                  .catch((reason: unknown) => console.error(reason))
              }
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * Browsing history over the assistant panel's conversation: full-text or by-meaning search,
 * bookmarks (pages with a note), and the note editor for the current page (Ctrl/Cmd+D, /note).
 * Opened by /history and closed with × or Escape.
 */
export function HistoryView() {
  const api = window.antimony
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('text')
  const [bookmarked, setBookmarked] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<HistoryPage | null | 'missing'>(null)
  // Bumped to search again: Enter in Meaning mode, a change in history.
  const [request, setRequest] = useState(0)
  const search = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      api.history.onOpen((openRequest) => {
        setOpen(true)
        setError(null)
        if (openRequest.query !== undefined) {
          setQuery(openRequest.query)
          setMode('text')
        }
        if (openRequest.note) {
          api.history
            .current()
            .then((page) => setCurrent(page ?? 'missing'))
            .catch((reason: unknown) => console.error(reason))
        } else {
          setCurrent(null)
          search.current?.focus()
        }
        setRequest((n) => n + 1)
      }),
    [api],
  )
  useEffect(() => api.history.onChanged(() => setRequest((n) => n + 1)), [api])

  const run = useCallback(
    (searchMode: SearchMode) => {
      let stale = false
      setBusy(true)
      api.history
        .search({ query, mode: searchMode, bookmarked })
        .then((found) => {
          if (stale) return
          setResult(found)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (!stale) setError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => {
          if (!stale) setBusy(false)
        })
      return () => {
        stale = true
      }
    },
    [api, query, bookmarked],
  )

  // Text search follows typing; search by meaning asks the model, so it waits for Enter.
  useEffect(() => {
    if (!open) return
    if (mode === 'semantic' && query.trim()) return
    let cancel = () => {}
    const timer = setTimeout(() => {
      cancel = run('text')
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      cancel()
    }
  }, [open, mode, query, bookmarked, request, run])

  const cancelSemantic = useRef<(() => void) | null>(null)
  const runSemantic = () => {
    if (!query.trim()) return
    cancelSemantic.current?.()
    cancelSemantic.current = run('semantic')
  }

  const close = () => {
    cancelSemantic.current?.()
    setOpen(false)
    setCurrent(null)
  }

  if (!open) return null

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const saveCurrentNote = (page: HistoryPage, note: string | null) => {
    api.history
      .setNote(page.id, note)
      .then(() => setCurrent(null))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
  }

  return (
    <section className="history-view" aria-label="History" onKeyDown={onKeyDown}>
      <header className="history-header">
        <h2>{bookmarked ? 'Bookmarks' : 'History'}</h2>
        <button type="button" className="assistant-hide" aria-label="Close history" onClick={close}>
          ×
        </button>
      </header>
      {current === 'missing' && (
        <p className="history-notice">This page isn’t in history, so it can’t have a note yet.</p>
      )}
      {current !== null && current !== 'missing' && (
        <div className="history-current">
          <p>
            Note for <strong>{current.title || bare(current.url)}</strong>
          </p>
          <NoteEditor
            initial={current.note ?? ''}
            label="Note for this page"
            onSave={(note) => saveCurrentNote(current, note)}
            onCancel={() => setCurrent(null)}
          />
        </div>
      )}
      <form
        className="history-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          if (mode === 'semantic') runSemantic()
          else setRequest((n) => n + 1)
        }}
      >
        <input
          ref={search}
          type="search"
          aria-label="Search history"
          placeholder={mode === 'semantic' ? 'Describe the page, then Enter' : 'Search history'}
          value={query}
          maxLength={500}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="history-filters">
          <div role="radiogroup" aria-label="Search by">
            {(['text', 'semantic'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                title={
                  value === 'semantic'
                    ? 'The selected model ranks pages by meaning (their titles, addresses, summaries and notes are sent to it)'
                    : 'Words in the page, its title, summary or note'
                }
                onClick={() => {
                  setMode(value)
                  if (value === 'semantic' && mode !== 'semantic') runSemantic()
                }}
              >
                {value === 'text' ? 'Text' : 'Meaning'}
              </button>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={bookmarked}
              onChange={(event) => setBookmarked(event.target.checked)}
            />
            Bookmarks
          </label>
        </div>
      </form>
      {error && (
        <p className="history-notice error" role="alert">
          {error}
        </p>
      )}
      {result?.notice && <p className="history-notice">{result.notice}</p>}
      {busy && <p className="history-notice">Searching…</p>}
      {result && !busy && result.pages.length === 0 && (
        <p className="history-notice">
          {bookmarked ? 'No noted pages match.' : 'No pages in history match.'}
        </p>
      )}
      <ul className="history-results" aria-label="History results">
        {result?.pages.map((page) => (
          <HistoryRow key={page.id} page={page} onChanged={() => setRequest((n) => n + 1)} />
        ))}
      </ul>
    </section>
  )
}
