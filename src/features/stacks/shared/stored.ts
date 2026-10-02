// Validation of stacks.json. Pure: no electron, Node or React imports.
import type { Stack, StackNode } from '../ipc'

/** stacks.json: the stacks, which one is current and the home page new stacks open at. */
export interface StoredStacks {
  current: string | null
  stacks: Stack[]
  home: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const isWebUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value)

function fail(message: string): never {
  throw new TypeError(`stacks.json: ${message}`)
}

function parseNode(key: string, raw: unknown): StackNode {
  if (!isRecord(raw)) fail(`node ${key} is not an object`)
  const { id, url, title, parentId, children, lastVisitedAt } = raw
  if (!isId(id) || String(id) !== key) fail(`node ${key} has a wrong id`)
  if (!isWebUrl(url)) fail(`node ${key} has no web URL`)
  if (typeof title !== 'string') fail(`node ${key} has no title`)
  if (parentId !== null && !isId(parentId)) fail(`node ${key} has a wrong parent`)
  if (!Array.isArray(children) || !children.every(isId)) fail(`node ${key} has wrong children`)
  if (typeof lastVisitedAt !== 'number') fail(`node ${key} has no visit time`)
  return { id, url, title, parentId, children: [...children], lastVisitedAt }
}

function parseStack(raw: unknown): Stack {
  if (!isRecord(raw)) fail('a stack is not an object')
  const { id, name, nodes, rootId, activeId, nextNodeId, lastUsedAt } = raw
  if (typeof id !== 'string' || !id) fail('a stack has no id')
  if (name !== null && typeof name !== 'string') fail(`stack ${id} has a wrong name`)
  if (!isRecord(nodes)) fail(`stack ${id} has no nodes`)
  const parsed: Record<number, StackNode> = {}
  for (const [key, node] of Object.entries(nodes)) parsed[Number(key)] = parseNode(key, node)
  const known = (ref: unknown) => ref === null || (isId(ref) && parsed[ref] !== undefined)
  for (const node of Object.values(parsed)) {
    if (
      !known(node.parentId) ||
      !node.children.every((child) => parsed[child]?.parentId === node.id)
    ) {
      fail(`stack ${id} has a broken tree`)
    }
  }
  if (!known(rootId) || !known(activeId) || (rootId === null) !== (activeId === null)) {
    fail(`stack ${id} has a wrong root or active node`)
  }
  if (rootId !== null && parsed[rootId as number]!.parentId !== null)
    fail(`stack ${id} root has a parent`)
  if (!isId(nextNodeId) || Object.keys(parsed).some((key) => Number(key) >= nextNodeId)) {
    fail(`stack ${id} has a wrong next node id`)
  }
  if (typeof lastUsedAt !== 'number') fail(`stack ${id} has no last use time`)
  return {
    id,
    name,
    nodes: parsed,
    rootId: rootId as number | null,
    activeId: activeId as number | null,
    nextNodeId,
    lastUsedAt,
  }
}

export function parseStoredStacks(raw: unknown): StoredStacks {
  if (!isRecord(raw) || !Array.isArray(raw['stacks'])) fail('expected { current, stacks }')
  const stacks = raw['stacks'].map(parseStack)
  const current = raw['current']
  if (current !== null && typeof current !== 'string') fail('current is not a stack id')
  // A home page that isn't a web URL is dropped (it's optional, older files have none).
  const home = isWebUrl(raw['home']) ? raw['home'] : null
  return { current: stacks.some((stack) => stack.id === current) ? current : null, stacks, home }
}
