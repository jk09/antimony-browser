import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { AgentState } from '../../agent/ipc'
import type { NavigationState } from '../../navigation/ipc'
import type { StackCommand, StackRow, StacksState } from '../ipc'
import { shortcutLabel } from '../shared/keys'
import { collapse, type CollapsedItem } from '../shared/tree'
import { matchRanges, searchPages, urlPrefixLength } from '../shared/search'

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

const platform = () => (/Mac/.test(navigator.userAgent) ? 'darwin' : 'other')
/** `Ctrl+R` (`Cmd+R` on macOS) as a hint, and `Control+R` (`Meta+R`) for aria-keyshortcuts. */
const hint = (command: StackCommand) => shortcutLabel(command, platform())
const ariaShortcut = (command: StackCommand) =>
  hint(command).replace(/^Cmd/, 'Meta').replace(/^Ctrl/, 'Control')

/** A Ctrl+Tab cycle: stack ids, most recently used first, and the highlighted index. */
interface Cycle {
  order: string[]
  index: number
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
  onClose,
}: {
  row: StackRow
  active: boolean
  loading: boolean
  onPick: (row: StackRow) => void
  /** Undefined while closing is blocked (the assistant runs). */
  onClose: ((row: StackRow) => void) | undefined
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
      data-row-id={row.id}
      onClick={() => onPick(row)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPick(row)
        } else if (event.key === 'Delete' && onClose) {
          event.preventDefault()
          onClose(row)
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
      <button
        type="button"
        className="stack-row-close"
        aria-label={`Close ${label}`}
        title={active ? `Close page (${hint('close-page')})` : 'Close page'}
        aria-keyshortcuts={active ? ariaShortcut('close-page') : undefined}
        tabIndex={active ? 0 : -1}
        disabled={!onClose}
        onClick={(event) => {
          event.stopPropagation()
          onClose?.(row)
        }}
      >
        ×
      </button>
    </li>
  )
}

/**
 * Keys in a tree that leave it: Escape returns to the page (`onLeave`), and a printable character
 * (no Ctrl/Cmd/Alt; Space still opens the row) starts a search with it (`onType`).
 */
function treeKeys(onLeave: (() => void) | undefined, onType: ((text: string) => void) | undefined) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (!target.hasAttribute('data-tree-item') || event.nativeEvent.isComposing) return
    const consume = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (event.key === 'Escape' && onLeave) {
      consume()
      onLeave()
    } else if (
      onType &&
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      consume()
      onType(event.key)
    }
  }
}

/** Rows, or the collapsed form of them (root, ellipses, the rows around the active one). */
function Tree({
  label,
  rows,
  activeId,
  loading,
  items,
  onPick,
  onClose,
  onMore,
  onLeave,
  onType,
}: {
  label: string
  rows: StackRow[]
  activeId: number | null
  loading: boolean
  items: CollapsedItem[]
  onPick: (row: StackRow) => void
  onClose: ((row: StackRow) => void) | undefined
  onMore?: (button: HTMLButtonElement) => void
  /** Escape in the tree (the full stack closes itself instead). */
  onLeave?: () => void
  /** A character typed in the tree: search with it. */
  onType?: (text: string) => void
}) {
  return (
    <ul
      role="tree"
      aria-label={label}
      className="stack-tree"
      onKeyDownCapture={treeKeys(onLeave, onType)}
      onKeyDown={moveFocus}
    >
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
              onClose={onClose}
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

/** `text` with the query's words marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of matchRanges(text, query)) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="stack-match">
        {text.slice(start, end)}
      </mark>,
    )
    at = end
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

/** The pages of the stack the search found; `selected` is what Enter opens. */
function Results({
  id,
  rows,
  hits,
  selected,
  query,
  activeId,
  maxHeight,
  onPick,
  onSelect,
}: {
  id: string
  rows: StackRow[]
  hits: number[]
  selected: number
  query: string
  activeId: number | null
  maxHeight: number
  onPick: (row: StackRow) => void
  onSelect: (index: number) => void
}) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  const count = `${hits.length} matching ${hits.length === 1 ? 'page' : 'pages'}`
  return (
    <div className="stack-results-wrap">
      <span className="visually-hidden" role="status">
        {count}
      </span>
      {hits.length === 0 ? (
        <p className="stack-results-empty">No matching pages</p>
      ) : (
        <ul
          ref={list}
          id={id}
          role="listbox"
          aria-label="Matching pages"
          className="stack-results"
          style={{ maxHeight }}
        >
          {hits.map((index, n) => {
            const row = rows[index]!
            return (
              <li
                key={row.id}
                id={`${id}-${row.id}`}
                role="option"
                aria-selected={n === selected}
                aria-current={row.id === activeId ? 'page' : undefined}
                className={`stack-result${n === selected ? ' selected' : ''}`}
                title={row.url}
                // Keep focus in the search box.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => n !== selected && onSelect(n)}
                onClick={() => onPick(row)}
              >
                <span className="stack-row-title">
                  <Highlight text={row.title || row.url} query={query} />
                </span>
                {row.title && (
                  <span className="stack-row-url">
                    {row.url.slice(0, urlPrefixLength(row.url))}
                    <Highlight text={row.url.slice(urlPrefixLength(row.url))} query={query} />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
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
  const panel = useRef<HTMLDivElement>(null)
  const tree = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const resultsId = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  // Set when the search closes: the active row takes focus once the tree is back.
  const refocusTree = useRef(false)
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

  const hits = useMemo(() => searchPages(current?.rows ?? [], query), [current, query])
  const searching = query.trim() !== ''
  const selectedHit = Math.min(selected, hits.length - 1)
  const focusActiveRow = () =>
    tree.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
  const startSearch = (text: string) => {
    setOverlayOpen(false)
    setQuery(text)
    setSelected(0)
    search.current?.focus()
  }
  const endSearch = () => {
    setQuery('')
    setSelected(0)
    // With results shown the tree comes back on the next render; else it is there already.
    if (searching) refocusTree.current = true
    else focusActiveRow()
  }
  useEffect(() => {
    if (searching || !refocusTree.current) return
    refocusTree.current = false
    focusActiveRow()
  })
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

  const reload = () => {
    if (activeId !== null) api.navigation.reload().catch(report)
  }
  const newStack = () => {
    if (running) return
    setListOpen(false)
    api.stacks.create().catch(report)
  }
  const closeRow = running
    ? undefined
    : (row: StackRow) => {
        setOverlayOpen(false)
        api.stacks.closeNode(row.id).catch(report)
      }
  const closeActive = () => {
    if (!running && activeId !== null) api.stacks.closeNode(activeId).catch(report)
  }

  // Ctrl+[Shift+]Tab: the stacks as they were when the cycle started (most recent first) and the
  // highlighted one; releasing Ctrl switches to it. The ref is what the handlers read.
  const cycleRef = useRef<Cycle | null>(null)
  const [cycle, setCycleState] = useState<Cycle | null>(null)
  const setCycle = (next: Cycle | null) => {
    cycleRef.current = next
    setCycleState(next)
    setListOpen(next !== null)
  }
  const cycleStep = (step: 1 | -1) => {
    const open = cycleRef.current
    if (open) {
      const count = open.order.length
      setCycle({ ...open, index: (open.index + step + count) % count })
      return
    }
    const order = (stacks?.stacks ?? []).map((stack) => stack.id)
    if (running || order.length < 2) return
    setCycle({ order, index: step === 1 ? 1 : order.length - 1 })
  }
  const cycleEnd = (switchTo: boolean) => {
    const open = cycleRef.current
    if (!open) return
    setCycle(null)
    const target = open.order[open.index]!
    const known = stacks?.stacks.some((stack) => stack.id === target)
    if (switchTo && known && target !== current?.id) api.stacks.switch(target).catch(report)
  }

  // Ctrl/Cmd+E: into the tree on the active page (the search box while searching), or back to the
  // page when already in the panel.
  const focusTree = () => {
    if (panel.current?.contains(document.activeElement)) void api.prompt.focusPage()
    else if (searching) search.current?.focus()
    else focusActiveRow()
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined) {
      event.preventDefault()
      if (hits.length > 0) setSelected((selectedHit + step + hits.length) % hits.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[selectedHit]
      if (hit === undefined) return
      pick(rows[hit]!)
      endSearch()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      endSearch()
    }
  }

  // Ctrl/Cmd+R, +N, +W, +E and Ctrl+Tab from main (caught in the page or the chrome UI) do what the
  // buttons and the stack list do.
  const commands = useRef({ reload, newStack, closeActive, focusTree, cycleStep, cycleEnd })
  useEffect(() => {
    commands.current = { reload, newStack, closeActive, focusTree, cycleStep, cycleEnd }
  })
  useEffect(
    () =>
      api.stacks.onCommand((command) => {
        const run = commands.current
        if (command === 'reload') run.reload()
        else if (command === 'new') run.newStack()
        else if (command === 'close-page') run.closeActive()
        else if (command === 'focus-tree') run.focusTree()
        else if (command === 'cycle-next') run.cycleStep(1)
        else if (command === 'cycle-previous') run.cycleStep(-1)
        else run.cycleEnd(command === 'cycle-end')
      }),
    [api],
  )
  const target = cycle ? cycle.order[cycle.index] : undefined

  return (
    <div className="stack-header" ref={panel}>
      <div className="stack-switcher" ref={list}>
        <button
          type="button"
          className="stack-name"
          aria-haspopup="dialog"
          aria-expanded={listOpen}
          title={blocked ?? 'Switch stack (Ctrl+Tab)'}
          aria-keyshortcuts="Control+Tab"
          onClick={() => setListOpen((open) => !open)}
        >
          {name ? `@${name}` : 'New tab'} <span aria-hidden="true">▾</span>
        </button>
        {rows.length > 0 && (
          <input
            ref={search}
            className="stack-search"
            type="text"
            role="combobox"
            aria-label="Search pages in this stack"
            aria-autocomplete="list"
            aria-expanded={searching && hits.length > 0}
            aria-controls={searching && hits.length > 0 ? resultsId : undefined}
            aria-activedescendant={
              searching && hits[selectedHit] !== undefined
                ? `${resultsId}-${rows[hits[selectedHit]]!.id}`
                : undefined
            }
            placeholder="Search pages"
            title="Search this stack's pages by title or URL (or start typing in the tree)"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={onSearchKey}
          />
        )}
        <span className="stack-actions">
          <button
            type="button"
            className="stack-action"
            aria-label="Reload page"
            title={`Reload page (${hint('reload')})`}
            aria-keyshortcuts={ariaShortcut('reload')}
            disabled={activeId === null}
            onClick={reload}
          >
            ↻
          </button>
          <button
            type="button"
            className="stack-action"
            aria-label="New stack"
            title={
              running ? 'Stop the assistant first to open a stack' : `New stack (${hint('new')})`
            }
            aria-keyshortcuts={ariaShortcut('new')}
            disabled={running}
            onClick={newStack}
          >
            +
          </button>
        </span>
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
                <li
                  key={stack.id}
                  className={
                    [stack.id === current?.id && 'current', stack.id === target && 'target']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  aria-selected={target === undefined ? undefined : stack.id === target}
                >
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
            <button type="button" className="stack-list-new" disabled={running} onClick={newStack}>
              + New stack
            </button>
          </div>
        )}
      </div>
      {rows.length > 0 && searching && (
        <Results
          id={resultsId}
          rows={rows}
          hits={hits}
          selected={selectedHit}
          query={query}
          activeId={activeId}
          maxHeight={maxRowsFor(height) * ROW_HEIGHT * 1.5}
          onPick={(row) => {
            pick(row)
            endSearch()
          }}
          onSelect={setSelected}
        />
      )}
      {rows.length > 0 && !searching && (
        <div ref={tree}>
          <Tree
            label="Navigation stack"
            rows={rows}
            activeId={activeId}
            loading={loading}
            items={collapse(rows.length, activeIndex, maxRowsFor(height))}
            onPick={pick}
            onClose={closeRow}
            onMore={(button) => {
              opener.current = button
              setOverlayOpen(true)
            }}
            onLeave={() => void api.prompt.focusPage()}
            onType={startSearch}
          />
        </div>
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
            onClose={closeRow}
            onType={startSearch}
          />
        </div>
      )}
    </div>
  )
}
