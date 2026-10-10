// Builds a stack from related pages read from another browser's export. Pure: no electron, Node
// or React imports.
import type { ImportedStack, Stack, StackNode } from '../ipc'
import { deriveName, MAX_NODES, newStack, samePage, slug, uniqueName } from './tree'

/** A group is already imported when this share of its pages is in an imported stack. */
export const KNOWN_SHARE = 0.8

/**
 * A stack whose pages are the group's, a chain in order (a repeat of the previous page reuses its
 * node), last used at the group's last visit. The newest pages win past `MAX_NODES`. It is named
 * by `name` (as a slug, unique among `taken`), else like any stack (first page's title, else host),
 * and its active page is the last one. `importedAt` marks it as made by an import.
 */
export function stackFromImport(
  id: string,
  group: ImportedStack,
  taken: Set<string>,
  importedAt: number,
): Stack {
  const stack = newStack(id, group.lastAt)
  let previous: StackNode | null = null
  for (const page of group.pages.slice(-MAX_NODES)) {
    if (previous && samePage(previous.url, page.url)) {
      if (previous.title === '') previous.title = page.title
      continue
    }
    const node: StackNode = {
      id: stack.nextNodeId++,
      url: page.url,
      title: page.title,
      parentId: previous?.id ?? null,
      children: [],
      lastVisitedAt: page.at,
    }
    stack.nodes[node.id] = node
    if (previous) previous.children.push(node.id)
    else stack.rootId = node.id
    previous = node
  }
  stack.activeId = previous?.id ?? null
  stack.imported = importedAt
  const base = slug(group.name)
  if (base) stack.name = uniqueName(base, taken)
  else deriveName(stack, taken, true)
  return stack
}

const withoutFragment = (url: string) => url.replace(/#.*$/, '')

/** Whether at least KNOWN_SHARE of the group's pages are among `known` addresses. */
export function mostlyKnown(group: ImportedStack, known: Set<string>): boolean {
  if (group.pages.length === 0) return true
  const inside = group.pages.filter((page) => known.has(withoutFragment(page.url))).length
  return inside / group.pages.length >= KNOWN_SHARE
}

export const addressOf = withoutFragment
