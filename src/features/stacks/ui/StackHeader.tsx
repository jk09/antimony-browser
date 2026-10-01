import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AgentState } from '../../agent/ipc'
import type { NavigationState } from '../../navigation/ipc'
import type { StackRow, StacksState } from '../ipc'
import { collapse, type CollapsedItem } from '../shared/tree'

export const MAX_ROWS = 8
export const MAX_HEIGHT_SHARE = 0.35
export const ROW_HEIGHT = 22
const INDENT_PX = 12
const MAX_INDENT_DEPTH = 8

/** Lines the tree may use in a window `height` px high: ≤ 8 and ≤ 35 % of it, at least 4. */
export const maxRowsFor = (height: number) =>
  Math.max(4, Math.min(MAX_ROWS, Math.floor((height * MAX_HEIGHT_SHARE) / ROW_HEIGHT)))

function useLive<T>(load: () => Promise<T>, subscribe: (fn: (value: T) => void) => () => void) {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    load()
      .then((initial) => live && setValue((current) => current ?? initial))
      .catch((reason: unknown) => console.error(reason))
    const unsubscribe = subscribe(setValue)
    return () => {
      live = false
      unsubscribe()
    }
    // load and subscribe are stable bridge functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}

function useWindowHeight() {
  const [height, setHeight] = useState(window.innerHeight)
  useEffect(() => {
    const update = () => setHeight(window.innerHeight)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return height
}

/** Moves focus between the tree's rows and ellipsis buttons with ↑ ↓ Home End. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-tree-item]'))
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = {
    ArrowDown: Math.min(items.length - 1, at + 1),
    ArrowUp: Math.max(0, at - 1),
    Home: 0,
    End: items.length - 1,
  }[event.key]
  if (next === undefined || items.length === 0) return
  event.preventDefault()
  items[next]?.focus()
}

function Row({
  row,
  active,
  loading,
  onPick,
}: {
  row: StackRow
  active: boolean
  loading: boolean
  onPick: (row: StackRow) => void
}) {
  const label = row.title || row.url
  return (
    <li
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={active}
      aria-current={active ? 'page' : undefined}
      className={`stack-row${active ? ' active' : ''}`}
      style={{ paddingLeft: Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT_PX }}
      title={row.url}
      tabIndex={active ? 0 : -1}
      data-tree-item=""
      onClick={() => onPick(row)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPick(row)
        }
      }}
    >
      {row.depth > 0 && (
        <span className="stack-connector" aria-hidden="true">
          {row.last ? '└' : '├'}
        </span>
      )}
      <span className="stack-row-text">
        <span className="stack-row-title">
          {label}
          {active && loading && <span className="stack-loading" aria-label="Loading" />}
        </span>
        {active && row.title && <span className="stack-row-url">{row.url}</span>}
      </span>
    </li>
  )
}

/** Rows, or the collapsed form of them (root, ellipses, the rows around the active one). */
function Tree({
  label,
  rows,
  activeId,
  loading,
  items,
  onPick,
  onMore,
}: {
  label: string
  rows: StackRow[]
  activeId: number | null
  loading: boolean
  items: CollapsedItem[]
  onPick: (row: StackRow) => void
  onMore?: (button: HTMLButtonElement) => void
}) {
  return (
    <ul role="tree" aria-label={label} className="stack-tree" onKeyDown={moveFocus}>
      {items.map((item): ReactNode => {
        if (item.kind === 'row') {
          const row = rows[item.index]!
          return (
            <Row
              key={row.id}
              row={row}
              active={row.id === activeId}
              loading={loading}
              onPick={onPick}
            />
          )
        }
        const hidden = item.to - item.from + 1
        return (
          <li role="none" key={`more-${item.from}`} className="stack-more-item">
            <button
              type="button"
              className="stack-more"
              data-tree-item=""
              tabIndex={-1}
              aria-label={`Show ${hidden} more pages`}
              onClick={(event) => onMore?.(event.currentTarget)}
            >
              ⋯ {hidden} more
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The assistant panel's header for the current tab: the stack switcher and the navigation tree.
 * Clicking a row goes to that page and leaves the tree as it is; a tree taller than the space
 * the header may take collapses its middle into ellipses that open the full stack.
 */
export function StackHeader() {
  const api = window.antimony
  const stacks = useLive<StacksState>(api.stacks.state, api.stacks.onChanged)
  const agent = useLive<AgentState>(api.agent.state, api.agent.onStateChanged)
  const [navigation, setNavigation] = useState<NavigationState | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const height = useWindowHeight()

  useEffect(() => api.navigation.onStateChanged(setNavigation), [api])

  const running = agent !== null && agent.status !== 'idle'
  const current = stacks?.current ?? null
  const rows = current?.rows ?? []
  const activeId = current?.activeId ?? null
  const activeIndex = rows.findIndex((row) => row.id === activeId)
  const loading = navigation?.loading ?? false
  const report = (reason: unknown) => console.error(reason)

  const closeOverlay = () => {
    setOverlayOpen(false)
    opener.current?.focus()
  }

  // The overlay and the stack list close on a click outside them.
  useEffect(() => {
    if (!overlayOpen && !listOpen) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (overlayOpen && !overlay.current?.contains(target)) setOverlayOpen(false)
      if (listOpen && !list.current?.contains(target)) setListOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [overlayOpen, listOpen])

  // The full stack opens scrolled to the active row, with focus on it.
  useEffect(() => {
    if (!overlayOpen) return
    const row = overlay.current?.querySelector<HTMLElement>('[aria-current="page"]')
    row?.scrollIntoView?.({ block: 'center' })
    row?.focus()
  }, [overlayOpen])

  const pick = (row: StackRow) => {
    setOverlayOpen(false)
    if (row.id !== activeId) api.stacks.goToNode(row.id).catch(report)
  }

  const name = current?.name || (current && rows.length > 0 ? rows[0]!.title || 'Untitled' : '')
  const blocked = running ? 'Stop the assistant first to switch stacks' : undefined

  return (
    <div className="stack-header">
      <div className="stack-switcher" ref={list}>
        <button
          type="button"
          className="stack-name"
          aria-haspopup="dialog"
          aria-expanded={listOpen}
          title={blocked ?? 'Switch stack'}
          onClick={() => setListOpen((open) => !open)}
        >
          {name ? `@${name}` : 'New tab'} <span aria-hidden="true">▾</span>
        </button>
        {listOpen && (
          <div
            className="stack-list"
            role="dialog"
            aria-label="Stacks"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setListOpen(false)
            }}
          >
            {blocked && <p className="stack-list-note">{blocked}</p>}
            <ul>
              {(stacks?.stacks ?? []).map((stack) => (
                <li key={stack.id} className={stack.id === current?.id ? 'current' : undefined}>
                  <button
                    type="button"
                    className="stack-list-item"
                    aria-current={stack.id === current?.id ? 'true' : undefined}
                    disabled={running}
                    onClick={() => {
                      setListOpen(false)
                      api.stacks.switch(stack.id).catch(report)
                    }}
                  >
                    <span className="stack-list-name">
                      {stack.name ? `@${stack.name}` : 'New tab'}
                    </span>
                    <span className="stack-list-detail">
                      {stack.rootTitle} · {stack.pages} {stack.pages === 1 ? 'page' : 'pages'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="stack-list-close"
                    aria-label={`Close ${stack.name ? `@${stack.name}` : 'New tab'}`}
                    disabled={running}
                    onClick={() => api.stacks.close(stack.id).catch(report)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="stack-list-new"
              disabled={running}
              onClick={() => {
                setListOpen(false)
                api.stacks.create().catch(report)
              }}
            >
              + New stack
            </button>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <Tree
          label="Navigation stack"
          rows={rows}
          activeId={activeId}
          loading={loading}
          items={collapse(rows.length, activeIndex, maxRowsFor(height))}
          onPick={pick}
          onMore={(button) => {
            opener.current = button
            setOverlayOpen(true)
          }}
        />
      )}
      {overlayOpen && (
        <div
          ref={overlay}
          className="stack-overlay"
          role="dialog"
          aria-label="Full stack"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closeOverlay()
            }
          }}
        >
          <div className="stack-overlay-head">
            <span>
              {name ? `@${name}` : 'Stack'} · {rows.length} pages
            </span>
            <button type="button" aria-label="Close full stack" onClick={closeOverlay}>
              ×
            </button>
          </div>
          <Tree
            label="Full navigation stack"
            rows={rows}
            activeId={activeId}
            loading={loading}
            items={rows.map((_, index) => ({ kind: 'row', index }))}
            onPick={pick}
          />
        </div>
      )}
    </div>
  )
}
