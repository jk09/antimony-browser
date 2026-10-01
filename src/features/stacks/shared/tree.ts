// Pure operations on a stack's tree: no electron, Node or React imports.
import type { Stack, StackNode, StackRow } from '../ipc'

export const MAX_STACKS = 50
export const MAX_NODES = 500
export const OUTLINE_LIMIT = 200
export const NAME_MAX = 32

/** How a navigation changed the tab's session history (navigation's `EntryChange`). */
export type EntryChange = 'new' | 'replaced' | 'back' | 'forward'

const withoutFragment = (url: string) => url.replace(/#.*$/, '')

/** The same page: equal URLs ignoring the fragment. */
export const samePage = (a: string, b: string) => withoutFragment(a) === withoutFragment(b)

export function newStack(id: string, now: number): Stack {
  return { id, name: null, nodes: {}, rootId: null, activeId: null, nextNodeId: 1, lastUsedAt: now }
}

export const nodeCount = (stack: Stack) => Object.keys(stack.nodes).length

export const activeNode = (stack: Stack): StackNode | null =>
  stack.activeId === null ? null : (stack.nodes[stack.activeId] ?? null)

function activate(stack: Stack, node: StackNode, url: string | null, now: number) {
  stack.activeId = node.id
  node.lastVisitedAt = now
  if (url !== null) node.url = url
}

/** Adds a child of the active node (or the root of an empty stack) and makes it active. */
function addChild(stack: Stack, url: string, now: number): StackNode {
  const parent = activeNode(stack)
  const node: StackNode = {
    id: stack.nextNodeId++,
    url,
    title: '',
    parentId: parent?.id ?? null,
    children: [],
    lastVisitedAt: now,
  }
  stack.nodes[node.id] = node
  if (parent) parent.children.push(node.id)
  else stack.rootId = node.id
  stack.activeId = node.id
  return node
}

/** A link from the active node: the same page stays, a known child is reused, else a new child. */
function follow(stack: Stack, url: string, now: number) {
  const current = activeNode(stack)
  if (!current) {
    addChild(stack, url, now)
    return
  }
  if (samePage(current.url, url)) {
    activate(stack, current, url, now)
    return
  }
  const child = current.children
    .map((id) => stack.nodes[id]!)
    .find((candidate) => samePage(candidate.url, url))
  if (child) activate(stack, child, url, now)
  else addChild(stack, url, now)
}

/**
 * Applies a committed navigation of the stack's tab. `target`: the node the navigation was started
 * from (a click in the tree, back/forward, a restore); it becomes active and the tree keeps its shape.
 */
export function navigated(
  stack: Stack,
  { url, entry, target }: { url: string; entry: EntryChange; target: number | null },
  now: number,
): void {
  const targeted = target === null ? undefined : stack.nodes[target]
  if (targeted) {
    activate(stack, targeted, url, now)
    return
  }
  const current = activeNode(stack)
  if (!current) {
    addChild(stack, url, now)
    return
  }
  switch (entry) {
    case 'replaced':
      activate(stack, current, url, now)
      return
    case 'back': {
      // The page went back by itself (history.back()): the nearest ancestor showing that page.
      for (let id = current.parentId; id !== null; id = stack.nodes[id]!.parentId) {
        const ancestor = stack.nodes[id]!
        if (samePage(ancestor.url, url)) {
          activate(stack, ancestor, url, now)
          return
        }
      }
      follow(stack, url, now)
      return
    }
    case 'forward':
    case 'new':
      follow(stack, url, now)
      return
  }
}

export function setTitle(stack: Stack, title: string): void {
  const node = activeNode(stack)
  if (node) node.title = title
}

/** The node back goes to: the active node's parent. */
export const backTarget = (stack: Stack): number | null => activeNode(stack)?.parentId ?? null

/** The node forward goes to: the active node's most recently visited child. */
export function forwardTarget(stack: Stack): number | null {
  const children = (activeNode(stack)?.children ?? []).map((id) => stack.nodes[id]!)
  if (children.length === 0) return null
  return children.reduce((best, child) => (child.lastVisitedAt > best.lastVisitedAt ? child : best))
    .id
}

/** Lowercase without accents, other non-alphanumerics → `-`, at most `NAME_MAX` characters; '' if nothing is left. */
export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/, '')
}

/** `base`, or `base-2`, `base-3`… if another stack has it, still at most `NAME_MAX` characters. */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const name = `${base.slice(0, NAME_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(name)) return name
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Names the stack once its root has a title (or, with `useHost`, from the root's host); a named
 * stack keeps its name. Returns whether the name was set.
 */
export function deriveName(stack: Stack, taken: Set<string>, useHost: boolean): boolean {
  if (stack.name !== null || stack.rootId === null) return false
  const root = stack.nodes[stack.rootId]!
  const base = slug(root.title) || (useHost ? slug(hostOf(root.url)) : '')
  if (!base) return false
  stack.name = uniqueName(base, taken)
  return true
}

/** The tree in depth-first order, children in creation order. */
export function rows(stack: Stack): StackRow[] {
  const result: StackRow[] = []
  if (stack.rootId === null) return result
  const todo: { id: number; depth: number; last: boolean }[] = [
    { id: stack.rootId, depth: 0, last: true },
  ]
  while (todo.length > 0) {
    const { id, depth, last } = todo.pop()!
    const node = stack.nodes[id]!
    result.push({ id, url: node.url, title: node.title, depth, last })
    for (let i = node.children.length - 1; i >= 0; i--) {
      todo.push({ id: node.children[i]!, depth: depth + 1, last: i === node.children.length - 1 })
    }
  }
  return result
}

/** Node ids from the root to `id`. */
export function pathTo(stack: Stack, id: number | null): number[] {
  const path: number[] = []
  for (let at = id; at !== null && stack.nodes[at]; at = stack.nodes[at]!.parentId) path.unshift(at)
  return path
}

export type CollapsedItem =
  | { kind: 'row'; index: number }
  /** Hidden rows `from`..`to` (inclusive). */
  | { kind: 'more'; from: number; to: number }

/**
 * Which rows to show when only `maxRows` lines fit (ellipsis lines included, at least 4): the
 * root, an ellipsis, then the last rows; if that would hide the active row, the rows up to it
 * and a second ellipsis for the rest.
 */
export function collapse(count: number, active: number, maxRows: number): CollapsedItem[] {
  const all = (from: number, to: number): CollapsedItem[] =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({ kind: 'row', index: from + i }))
  const max = Math.max(4, maxRows)
  if (count <= max) return all(0, count - 1)
  const tailStart = count - (max - 2)
  if (active <= 0 || active >= tailStart) {
    return [
      ...all(0, 0),
      { kind: 'more', from: 1, to: tailStart - 1 },
      ...all(tailStart, count - 1),
    ]
  }
  const start = active - (max - 3) + 1
  if (start <= 1) {
    return [...all(0, max - 2), { kind: 'more', from: max - 1, to: count - 1 }]
  }
  return [
    ...all(0, 0),
    { kind: 'more', from: 1, to: start - 1 },
    ...all(start, active),
    { kind: 'more', from: active + 1, to: count - 1 },
  ]
}

/** The stack as text for the model: one line per page, indented by depth, the current one marked. */
export function outline(stack: Stack, limit = OUTLINE_LIMIT): string {
  const all = rows(stack)
  const keep = new Set(pathTo(stack, stack.activeId))
  for (const row of all) {
    if (keep.size >= limit) break
    keep.add(row.id)
  }
  const lines = [
    `Navigation stack @${stack.name ?? ''} (${all.length} pages, tree of followed links):`,
  ]
  for (const row of all) {
    if (!keep.has(row.id)) continue
    const current = row.id === stack.activeId ? ' ← current' : ''
    lines.push(`${'  '.repeat(row.depth)}- ${row.title || '(untitled)'} — ${row.url}${current}`)
  }
  if (keep.size < all.length) lines.push(`… ${all.length - keep.size} more pages not shown`)
  return lines.join('\n')
}

/**
 * Drops the least recently visited leaves that aren't on the path to the active node until the
 * stack has at most `max` nodes.
 */
export function prune(stack: Stack, max = MAX_NODES): void {
  while (nodeCount(stack) > max) {
    const path = new Set(pathTo(stack, stack.activeId))
    let victim: StackNode | null = null
    for (const node of Object.values(stack.nodes)) {
      if (node.children.length > 0 || path.has(node.id)) continue
      if (!victim || node.lastVisitedAt < victim.lastVisitedAt) victim = node
    }
    if (!victim) return
    const parent = victim.parentId === null ? null : stack.nodes[victim.parentId]
    if (parent) parent.children = parent.children.filter((id) => id !== victim.id)
    delete stack.nodes[victim.id]
  }
}

/** Keeps only the active node, as the root (history cleared). */
export function trimToActive(stack: Stack): void {
  const node = activeNode(stack)
  if (!node) {
    stack.nodes = {}
    stack.rootId = null
    return
  }
  stack.nodes = { [node.id]: { ...node, parentId: null, children: [] } }
  stack.rootId = node.id
}
