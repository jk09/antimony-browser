import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_QUERY, type RecalledPage, type RecallResult, type RecallView as View } from '../ipc'
import { layoutCloud, scaleSize, type CloudItem } from '../shared/cloud-layout'
import { sketchToJpeg, SketchPad, type Stroke } from './SketchPad'

const WORD_SIZE = [13, 48] as const
const TILE_WIDTH = [96, 230] as const
const COLOURS = 5

const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '')
const titleOf = (page: RecalledPage) => page.title || bare(page.url)

/** Sizes the cloud's items for the layout; words by weight, pages by score. */
export function cloudItems(result: RecallResult, view: View): (CloudItem & { weight: number })[] {
  if (view === 'words') {
    const weights = result.keywords.map((keyword) => keyword.weight)
    const [low, high] = [Math.min(...weights), Math.max(...weights)]
    return result.keywords.map((keyword) => {
      const size = scaleSize(keyword.weight, low, high, ...WORD_SIZE)
      return {
        id: keyword.text,
        weight: keyword.weight,
        width: Math.ceil(keyword.text.length * size * 0.56 + 10),
        height: Math.ceil(size * 1.3),
      }
    })
  }
  const scores = result.pages.map((page) => page.score)
  const [low, high] = [Math.min(...scores), Math.max(...scores)]
  return result.pages.map((page) => {
    const width = scaleSize(page.score, low, high, ...TILE_WIDTH)
    return { id: String(page.id), weight: page.score, width, height: Math.round(width * 0.62) }
  })
}

/** Measures an element's content box; 0 × 0 where ResizeObserver doesn't exist (tests). */
function useSize(element: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return size
}

function Cloud({
  result,
  view,
  thumbnails,
  selected,
  onKeyword,
  onPage,
}: {
  result: RecallResult
  view: View
  thumbnails: Map<number, string>
  selected: string | null
  onKeyword: (text: string) => void
  onPage: (page: RecalledPage) => void
}) {
  const [area, setArea] = useState<HTMLElement | null>(null)
  const size = useSize(area)
  const items = useMemo(() => cloudItems(result, view), [result, view])
  const layout = useMemo(() => layoutCloud(items), [items])
  const fontSize = new Map(items.map((item) => [item.id, Math.round(item.height / 1.3)]))
  const pages = new Map(result.pages.map((page) => [String(page.id), page]))
  const keywords = new Map(result.keywords.map((keyword) => [keyword.text, keyword]))
  const { bounds } = layout
  const scale =
    size.width && size.height && bounds.width && bounds.height
      ? Math.min(1.5, (size.width - 24) / bounds.width, (size.height - 24) / bounds.height)
      : 1

  return (
    <div className="recall-cloud" ref={setArea}>
      <ul
        className={`recall-cloud-items recall-${view}`}
        aria-label={view === 'words' ? 'Keyword cloud' : 'Picture cloud'}
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `scale(${Math.max(0.2, scale)})`,
        }}
      >
        {layout.items.map((item, index) => {
          const style = {
            left: item.x - bounds.left,
            top: item.y - bounds.top,
            width: item.width,
            height: item.height,
          }
          if (view === 'words') {
            const keyword = keywords.get(item.id)!
            const count = keyword.pageIds.length
            return (
              <li key={item.id} style={style}>
                <button
                  type="button"
                  className={`recall-word recall-colour-${index % COLOURS}`}
                  style={{ fontSize: fontSize.get(item.id) }}
                  aria-pressed={selected === keyword.text}
                  aria-label={`${keyword.text}, ${count} ${count === 1 ? 'page' : 'pages'}`}
                  onClick={() => onKeyword(keyword.text)}
                >
                  {keyword.text}
                </button>
              </li>
            )
          }
          const page = pages.get(item.id)!
          const thumbnail = thumbnails.get(page.id)
          return (
            <li key={item.id} style={style}>
              <button
                type="button"
                className="recall-tile"
                title={`${titleOf(page)}\n${bare(page.url)}`}
                aria-label={titleOf(page)}
                onClick={() => onPage(page)}
              >
                {thumbnail ? (
                  <img src={thumbnail} alt="" />
                ) : (
                  <span className="recall-tile-title">{titleOf(page)}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Recall: pages from history that match a request or a sketch, chosen by the selected model and
 * shown as a keyword or picture cloud over the page area (the page view is hidden meanwhile).
 * Opened by /recall and File → Recall from History…, closed with × or Escape.
 */
export function RecallView() {
  const api = window.antimony
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [result, setResult] = useState<RecallResult | null>(null)
  const [view, setView] = useState<View>('words')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState(new Map<number, string>())
  const latest = useRef(0)
  const field = useRef<HTMLInputElement>(null)
  // The sketch as recall sees it when /recall opens the view.
  const sketch = useRef<Stroke[]>([])
  const requested = useRef(new Set<number>())

  const changeStrokes = (next: Stroke[]) => {
    sketch.current = next
    setStrokes(next)
  }

  const recall = useCallback(
    (text: string) => {
      const jpeg = sketchToJpeg(sketch.current)
      if (!text.trim() && !jpeg) return
      const id = ++latest.current
      setBusy(true)
      setError(null)
      setSelected(null)
      api.history
        .recall({ query: text.trim(), sketch: jpeg })
        .then((found) => {
          if (id !== latest.current) return
          setResult(found)
          setView(found.view)
        })
        .catch((reason: unknown) => {
          if (id === latest.current) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        })
        .finally(() => {
          if (id === latest.current) setBusy(false)
        })
    },
    [api],
  )

  useEffect(
    () =>
      api.history.onOpenRecall((text) => {
        setOpen(true)
        setQuery(text)
        field.current?.focus()
        if (text.trim()) recall(text)
      }),
    [api, recall],
  )

  // Screenshots of recalled pages, for the picture cloud and the keyword's page list.
  useEffect(() => {
    if (!result) return
    for (const page of result.pages) {
      if (!page.hasScreenshot || requested.current.has(page.id)) continue
      requested.current.add(page.id)
      api.history
        .screenshot(page.id)
        .then((url) => {
          if (url) setThumbnails((map) => new Map(map).set(page.id, url))
        })
        .catch((reason: unknown) => {
          requested.current.delete(page.id)
          console.error(reason)
        })
    }
  }, [api, result])

  if (!open) return null

  const close = () => {
    latest.current++
    setBusy(false)
    setOpen(false)
    api.history.cancelRecall().catch((reason: unknown) => console.error(reason))
  }

  const openPage = (page: RecalledPage) => {
    close()
    api.navigation.go(page.url).catch((reason: unknown) => console.error(reason))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const keyword = result?.keywords.find((k) => k.text === selected) ?? null
  const keywordPages = keyword
    ? (result?.pages.filter((page) => keyword.pageIds.includes(page.id)) ?? [])
    : []

  return (
    <section className="recall-view" aria-label="Recall" onKeyDown={onKeyDown}>
      <header className="recall-header">
        <h2>Recall</h2>
        <button type="button" className="assistant-hide" aria-label="Close recall" onClick={close}>
          ×
        </button>
      </header>
      <form
        className="recall-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          recall(query)
        }}
      >
        <div className="recall-request">
          <input
            ref={field}
            type="search"
            aria-label="What to recall"
            placeholder="show all pages about lions"
            value={query}
            maxLength={MAX_QUERY}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="recall-controls">
            <div role="radiogroup" aria-label="Show as">
              {(['words', 'images'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  onClick={() => setView(value)}
                >
                  {value === 'words' ? 'Words' : 'Pictures'}
                </button>
              ))}
            </div>
            <button type="submit" disabled={busy || (!query.trim() && strokes.length === 0)}>
              Recall
            </button>
          </div>
          <p className="recall-hint">
            The selected model picks the pages: it gets their titles, addresses, summaries and notes
            {strokes.length > 0 && ', your sketch and up to 16 small screenshots of them'}.
          </p>
        </div>
        <SketchPad strokes={strokes} onChange={changeStrokes} />
      </form>
      {error && (
        <p className="recall-notice error" role="alert">
          {error}
        </p>
      )}
      {result?.notice && <p className="recall-notice">{result.notice}</p>}
      {busy && <p className="recall-notice">Recalling…</p>}
      {result && !busy && result.pages.length === 0 && (
        <p className="recall-notice">Nothing in history matches.</p>
      )}
      <div className="recall-body">
        {result && result.pages.length > 0 && (
          <Cloud
            result={result}
            view={view}
            thumbnails={thumbnails}
            selected={selected}
            onKeyword={(text) => setSelected(text === selected ? null : text)}
            onPage={openPage}
          />
        )}
        {keyword && view === 'words' && (
          <aside className="recall-pages" aria-label={`Pages about ${keyword.text}`}>
            <h3>{keyword.text}</h3>
            <ul>
              {keywordPages.map((page) => (
                <li key={page.id}>
                  <button type="button" onClick={() => openPage(page)}>
                    {thumbnails.get(page.id) && <img src={thumbnails.get(page.id)} alt="" />}
                    <span className="recall-page-title">{titleOf(page)}</span>
                    <span className="recall-page-url">{bare(page.url)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </section>
  )
}
