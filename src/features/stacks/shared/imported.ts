// Builds a stack from a browsing session read from another browser's export. Pure: no electron,
// Node or React imports.
import type { ImportedSession, Stack, StackNode } from '../ipc'
import { deriveName, MAX_NODES, newStack, samePage } from './tree'

/**
 * A stack whose pages are the session's, a chain in visit order (a repeat of a page reuses its
 * node), last used when the session ended. The newest pages win past `MAX_NODES`. The stack is
 * named like any other (root title, else host) and its active page is the last one.
 */
export function stackFromSession(id: string, session: ImportedSession, taken: Set<string>): Stack {
  const stack = newStack(id, session.endedAt)
  const pages = session.pages.slice(-MAX_NODES)
  let previous: StackNode | null = null
  for (const page of pages) {
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
  stack.imported = session.startedAt
  deriveName(stack, taken, true)
  return stack
}
