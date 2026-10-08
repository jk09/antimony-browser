import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MAP_RANGES, MAX_MAP_TEXT, type MapNode, type MapRange, type MapResult } from '../ipc'
import { layoutMap, type Box } from '../shared/map-layout'
import { scaleSize } from '../shared/cloud-layout'

const RANGE_LABELS: Record<MapRange, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  all: 'All time',
}
const NODE_WIDTH = [104, 176] as const
const NODE_HEIGHT = 28
const OTHER = 0

const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '')
const titleOf = (node: MapNode) => node.title || bare(node.url)
const clip = (text: string, width: number) => {
  const max = Math.floor(width / 7)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
const centre = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

/** The point on a box's border towards `to`, so arrows end at the node and not at its middle. */
function border(box: Box, to: { x: number; y: number }) {
  const from = centre(box)
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return from
  const t = Math.min(
    box.width / 2 / Math.abs(dx || Infinity),
    box.height / 2 / Math.abs(dy || Infinity),
  )
  return { x: from.x + dx * t, y: from.y + dy * t }
}

/**
 * History map: visited pages as nodes in labelled groups (same site or shared keywords), joined by
 * arrows where a link was followed and dashed lines where pages share keywords. Shown over the page
 * area (the page view is hidden meanwhile); opened by /history-map, closed with × or Escape.
 */
export function MapView() {
  const api = window.antimony
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<MapRange>('7d')
  const [text, setText] = useState('')
  const [result, setResult] = useState<MapResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const latest = useRef(0)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const field = useRef<HTMLInputElement>(null)
  /** The page whose outline button has keyboard focus; its node on the map shows a focus ring. */
  const [focused, setFocused] = useState<number | null>(null)

  const load = useCallback(
    (next: { range: MapRange; text: string }) => {
      const id = ++latest.current
      api.history
        .map(next)
        .then((found) => {
          if (id !== latest.current) return
          setResult(found)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (id === latest.current)
            setError(reason instanceof Error ? reason.message : String(reason))
        })
    },
    [api],
  )

  // Keyboard focus goes into the page, so Escape closes it (as on the Recall page).
  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])

  useEffect(
    () =>
      api.history.onOpenMap(() => {
        setOpen(true)
        setView({ x: 0, y: 0, k: 1 })
        load({ range, text })
      }),
    [api, load, range, text],
  )

  useEffect(
    () => (open ? api.history.onChanged(() => load({ range, text })) : undefined),
    [api, open, load, range, text],
  )

  const layout = useMemo(() => {
    if (!result) return null
    const visits = result.nodes.map((node) => node.visitCount)
    const [low, high] = [Math.min(...visits), Math.max(...visits)]
    const groups = [
      ...result.groups.map((group) => ({
        id: group.id,
        label: group.label,
        nodes: result.nodes.filter((node) => node.group === group.id),
      })),
      { id: OTHER, label: 'Other', nodes: result.nodes.filter((node) => node.group === null) },
    ].map((group) => ({
      ...group,
      nodes: group.nodes.map((node) => ({
        id: node.id,
        width: scaleSize(node.visitCount, low, high, ...NODE_WIDTH),
        height: NODE_HEIGHT,
      })),
    }))
    const groupOf = new Map(result.nodes.map((node) => [node.id, node.group ?? OTHER]))
    const links = result.edges.flatMap((edge) => {
      const [a, b] = [groupOf.get(edge.from), groupOf.get(edge.to)]
      return a === undefined || b === undefined || a === b ? [] : [{ a, b, weight: edge.weight }]
    })
    return { groups, placed: layoutMap(groups, links) }
  }, [result])

  if (!open) return null

  const close = () => {
    latest.current++
    setOpen(false)
  }
  const openPage = (node: MapNode) => {
    close()
    api.navigation.go(node.url).catch((reason: unknown) => console.error(reason))
  }
  const change = (next: { range?: MapRange; text?: string }) => {
    const updated = { range, text, ...next }
    setRange(updated.range)
    setText(updated.text)
    load(updated)
  }
  const zoom = (factor: number) =>
    setView((current) => ({ ...current, k: Math.min(4, Math.max(0.25, current.k * factor)) }))
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const nodes = new Map(result?.nodes.map((node) => [node.id, node]))
  const placed = layout?.placed
  const pad = 24
  const bounds = placed?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
  const empty = result !== null && result.nodes.length === 0
  const label = (id: number) =>
    id === OTHER ? 'Other' : (result?.groups.find((group) => group.id === id)?.label ?? '')

  return (
    <section className="recall-view map-view" aria-label="History map" onKeyDown={onKeyDown}>
      <header className="recall-header">
        <h2>History map</h2>
        <button
          type="button"
          className="assistant-hide"
          aria-label="Close history map"
          onClick={close}
        >
          ×
        </button>
      </header>
      <div className="map-controls">
        <input
          ref={field}
          type="search"
          aria-label="Filter pages"
          placeholder="Filter by title, address or keyword"
          value={text}
          maxLength={MAX_MAP_TEXT}
          onChange={(event) => change({ text: event.target.value })}
        />
        <div role="radiogroup" aria-label="Time range">
          {MAP_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={range === value}
              onClick={() => change({ range: value })}
            >
              {RANGE_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="map-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>
            −
          </button>
        </div>
        <p className="map-legend">
          <span aria-hidden="true">→</span> followed a link · <span aria-hidden="true">┄</span>{' '}
          share keywords
        </p>
      </div>
      {error && (
        <p className="recall-notice error" role="alert">
          {error}
        </p>
      )}
      {result && result.total > result.nodes.length && (
        <p className="recall-notice">
          Showing the {result.nodes.length} most recent of {result.total} pages.
        </p>
      )}
      {empty && (
        <p className="recall-notice">
          {text.trim() ? 'Nothing matches.' : 'No pages in this range.'}
        </p>
      )}
      {result && placed && !empty && (
        <>
          <svg
            ref={svg}
            className="map-canvas"
            aria-hidden="true"
            viewBox={`${bounds.x - pad} ${bounds.y - pad} ${bounds.width + 2 * pad} ${bounds.height + 2 * pad}`}
            onPointerDown={(event) => {
              drag.current = { x: event.clientX, y: event.clientY }
            }}
            onPointerMove={(event) => {
              const last = drag.current
              if (!last) return
              const scale = (bounds.width + 2 * pad) / (svg.current?.clientWidth || 1)
              setView((current) => ({
                ...current,
                x: current.x + (event.clientX - last.x) * scale,
                y: current.y + (event.clientY - last.y) * scale,
              }))
              drag.current = { x: event.clientX, y: event.clientY }
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
            onWheel={(event) => zoom(event.deltaY < 0 ? 1.1 : 0.9)}
          >
            <defs>
              <marker
                id="map-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0 0 L10 5 L0 10 z" className="map-arrow" />
              </marker>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {placed.groups.map((box) => (
                <g key={box.id} className="map-group">
                  <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={8} />
                  <text x={box.x + 12} y={box.y + 18}>
                    {label(box.id)}
                  </text>
                </g>
              ))}
              {result.edges.map((edge) => {
                const [a, b] = [placed.nodes.get(edge.from), placed.nodes.get(edge.to)]
                if (!a || !b) return null
                const [from, to] = [centre(a), centre(b)]
                // A gentle curve, so edges between distant groups don't run straight through
                // the pages in between; it bends to the right of its direction, so a pair of
                // arrows in opposite directions doesn't overlap.
                const bend = Math.hypot(to.x - from.x, to.y - from.y) * 0.12
                const angle = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2
                const control = {
                  x: (from.x + to.x) / 2 + Math.cos(angle) * bend,
                  y: (from.y + to.y) / 2 + Math.sin(angle) * bend,
                }
                const start = border(a, control)
                const end = border(b, control)
                return (
                  <path
                    key={`${edge.kind}-${edge.from}-${edge.to}`}
                    className={`map-edge map-edge-${edge.kind}`}
                    d={`M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}`}
                    fill="none"
                    markerEnd={edge.kind === 'link' ? 'url(#map-arrow)' : undefined}
                  />
                )
              })}
              {result.nodes.map((node) => {
                const box = placed.nodes.get(node.id)
                if (!box) return null
                return (
                  <g
                    key={node.id}
                    className={focused === node.id ? 'map-node map-node-focus' : 'map-node'}
                    onClick={() => openPage(node)}
                    style={{ cursor: 'pointer' }}
                  >
                    <title>{`${titleOf(node)}\n${bare(node.url)}\n${new Date(node.lastVisitAt).toLocaleString()}${node.keywords.length ? `\n${node.keywords.join(', ')}` : ''}`}</title>
                    <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={6} />
                    <text x={box.x + 8} y={box.y + box.height / 2 + 4}>
                      {clip(titleOf(node), box.width - 8)}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
          <nav className="map-outline" aria-label="Pages by group">
            {layout.groups.map((group) =>
              group.nodes.length === 0 ? null : (
                <section key={group.id}>
                  <h3>{label(group.id)}</h3>
                  <ul>
                    {group.nodes.map(({ id }) => {
                      const node = nodes.get(id)!
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => openPage(node)}
                            onFocus={() => setFocused(id)}
                            onBlur={() =>
                              setFocused((current) => (current === id ? null : current))
                            }
                          >
                            {titleOf(node)}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ),
            )}
          </nav>
        </>
      )}
    </section>
  )
}
