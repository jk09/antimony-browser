import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { onHistoryCleared } from '../history/main'
import { getTabs, onPageEvent, setHistoryResolver, type PageEvent } from '../navigation/main'
import {
  channels,
  DEFAULT_NEW_STACK_PAGE,
  type Stack,
  type StacksSettings,
  type StacksState,
} from './ipc'
import { parseStacksSettings, parseStoredStacks, type StoredStacks } from './shared/stored'
import {
  backTarget,
  deriveName,
  forwardTarget,
  MAX_STACKS,
  namingNode,
  navigated,
  newStack,
  nodeCount,
  outline,
  prune,
  rows,
  setTitle,
  trimToActive,
} from './shared/tree'

const PUBLISH_DELAY_MS = 16

export function register({ ipc }: MainContext): void {
  const tabs = getTabs()
  if (!tabs) throw new Error('stacks needs navigation to be registered first')

  const store = createJsonStore(join(app.getPath('userData'), 'stacks.json'), {
    parse: parseStoredStacks,
    fallback: (): StoredStacks => ({ current: null, stacks: [] }),
  })
  const settings = createJsonStore(join(app.getPath('userData'), 'stacks-settings.json'), {
    parse: parseStacksSettings,
    fallback: (): StacksSettings => ({ newStackPage: DEFAULT_NEW_STACK_PAGE }),
  })
  app.on('will-quit', () => {
    store.flush()
    settings.flush()
  })

  const stacks = new Map<string, Stack>(store.get().stacks.map((stack) => [stack.id, stack]))
  let currentId: string | null = store.get().current
  const tabOfStack = new Map<string, number>()
  const stackOfTab = new Map<number, string>()
  /** The node a navigation was started from, per stack, until it commits or fails. */
  const targets = new Map<string, number>()

  const byRecentUse = () => [...stacks.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  const current = () => (currentId === null ? null : (stacks.get(currentId) ?? null))

  const rootTitle = (stack: Stack) => {
    const node = namingNode(stack) ?? (stack.rootId === null ? null : stack.nodes[stack.rootId]!)
    return node ? node.title || node.url : ''
  }

  const state = (): StacksState => {
    const stack = current()
    return {
      current: stack && {
        id: stack.id,
        name: stack.name ?? '',
        rows: rows(stack),
        activeId: stack.activeId,
      },
      stacks: byRecentUse().map((s) => ({
        id: s.id,
        name: s.name ?? '',
        rootTitle: rootTitle(s),
        pages: nodeCount(s),
      })),
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  const changed = () => {
    store.set({ current: currentId, stacks: [...stacks.values()] })
    timer ??= setTimeout(() => {
      timer = null
      ipc.send(channels.stateChanged, state())
    }, PUBLISH_DELAY_MS)
  }

  const bind = (stack: Stack, tabId: number) => {
    tabOfStack.set(stack.id, tabId)
    stackOfTab.set(tabId, stack.id)
  }

  const makeCurrent = (stack: Stack) => {
    currentId = stack.id
    stack.lastUsedAt = Date.now()
  }

  const closeStack = (stack: Stack) => {
    const tabId = tabOfStack.get(stack.id)
    stacks.delete(stack.id)
    targets.delete(stack.id)
    tabOfStack.delete(stack.id)
    if (tabId !== undefined) {
      stackOfTab.delete(tabId)
      tabs.close(tabId)
    }
    if (currentId === stack.id) currentId = null
  }

  const addStack = (): Stack => {
    const stack = newStack(randomUUID(), Date.now())
    stacks.set(stack.id, stack)
    // Keep at most MAX_STACKS: the least recently used other stacks go.
    const others = byRecentUse().filter((s) => s !== stack && s.id !== currentId)
    while (stacks.size > MAX_STACKS && others.length > 0) closeStack(others.pop()!)
    return stack
  }

  const takenNames = (except: Stack) =>
    new Set([...stacks.values()].flatMap((s) => (s !== except && s.name !== null ? [s.name] : [])))

  /** The stack of a tab; a tab main didn't create here (the first typed URL) gets one. */
  const stackFor = (tabId: number): Stack => {
    const known = stackOfTab.get(tabId)
    if (known !== undefined) return stacks.get(known)!
    const cur = current()
    const stack = cur && !tabOfStack.has(cur.id) && cur.rootId === null ? cur : addStack()
    bind(stack, tabId)
    if (tabs.active() === tabId) makeCurrent(stack)
    return stack
  }

  /** Loads a node in its stack's tab (created, and shown if current, when it isn't live). */
  const goToNode = (stack: Stack, nodeId: number) => {
    const node = stack.nodes[nodeId]
    if (!node) return
    targets.set(stack.id, nodeId)
    const tabId = tabOfStack.get(stack.id)
    if (tabId === undefined) {
      const created = tabs.create({
        url: node.url,
        activate: stack.id === currentId,
        transition: 'back_forward',
      })
      bind(stack, created)
      return
    }
    // The nearest entry of Chromium's history with that URL (back-forward cache), else a load.
    const history = tabs.entries(tabId)
    let best = -1
    if (history) {
      history.urls.forEach((url, index) => {
        if (index === history.index || url !== node.url) return
        if (best < 0 || Math.abs(index - history.index) < Math.abs(best - history.index)) {
          best = index
        }
      })
    }
    if (best >= 0) tabs.goToIndex(tabId, best)
    else tabs.load(tabId, node.url, 'back_forward')
  }

  /**
   * Makes an empty stack current in a new tab (the empty current stack if it has no tab yet),
   * loading the new-stack page as its root if one is set.
   */
  const openNewStack = () => {
    const cur = current()
    const stack = cur && cur.rootId === null && !tabOfStack.has(cur.id) ? cur : addStack()
    makeCurrent(stack)
    const url = settings.get().newStackPage
    if (url !== null) stack.startRoot = true
    bind(stack, tabs.create({ activate: true, ...(url !== null && { url, transition: 'typed' }) }))
    changed()
  }

  const switchTo = (stack: Stack) => {
    makeCurrent(stack)
    const tabId = tabOfStack.get(stack.id)
    if (tabId !== undefined) tabs.activate(tabId)
    else if (stack.activeId !== null) goToNode(stack, stack.activeId)
    else bind(stack, tabs.create({ activate: true }))
    changed()
  }

  setHistoryResolver({
    back: (tabId) => {
      const stack = stacks.get(stackOfTab.get(tabId) ?? '')
      if (!stack) return false
      const target = backTarget(stack)
      if (target !== null) goToNode(stack, target)
      return true
    },
    forward: (tabId) => {
      const stack = stacks.get(stackOfTab.get(tabId) ?? '')
      if (!stack) return false
      const target = forwardTarget(stack)
      if (target !== null) goToNode(stack, target)
      return true
    },
    canGoBack: (tabId) => {
      const stack = stacks.get(stackOfTab.get(tabId) ?? '')
      return stack !== undefined && backTarget(stack) !== null
    },
    canGoForward: (tabId) => {
      const stack = stacks.get(stackOfTab.get(tabId) ?? '')
      return stack !== undefined && forwardTarget(stack) !== null
    },
  })

  const onEvent = (event: PageEvent) => {
    switch (event.type) {
      case 'opened': {
        const stack = addStack()
        bind(stack, event.tabId)
        if (event.active) makeCurrent(stack)
        changed()
        return
      }
      case 'activated': {
        const id = stackOfTab.get(event.tabId)
        if (id !== undefined && id !== currentId) {
          makeCurrent(stacks.get(id)!)
          changed()
        }
        return
      }
      case 'navigated':
      case 'navigated-in-page': {
        const stack = stackFor(event.tabId)
        navigated(
          stack,
          { url: event.url, entry: event.entry, target: targets.get(stack.id) ?? null },
          Date.now(),
        )
        targets.delete(stack.id)
        if (stack.id === currentId) stack.lastUsedAt = Date.now()
        prune(stack)
        deriveName(stack, takenNames(stack), false)
        changed()
        return
      }
      case 'failed': {
        const id = stackOfTab.get(event.tabId)
        if (id !== undefined) targets.delete(id)
        return
      }
      case 'title': {
        const id = stackOfTab.get(event.tabId)
        const stack = id === undefined ? undefined : stacks.get(id)
        if (!stack) return
        setTitle(stack, event.title)
        deriveName(stack, takenNames(stack), false)
        changed()
        return
      }
      case 'loaded': {
        const id = stackOfTab.get(event.tabId)
        const stack = id === undefined ? undefined : stacks.get(id)
        if (stack && deriveName(stack, takenNames(stack), true)) changed()
        return
      }
    }
  }
  onPageEvent(onEvent)

  onHistoryCleared((all) => {
    if (!all) return
    for (const stack of [...stacks.values()]) {
      if (stack.id === currentId) trimToActive(stack)
      else closeStack(stack)
    }
    changed()
  })

  const parseStackId = (channel: string, value: unknown): Stack => {
    const stack = typeof value === 'string' ? stacks.get(value) : undefined
    if (!stack) throw new TypeError(`${channel} expects the id of an open stack`)
    return stack
  }

  ipc.handle(channels.state, () => state())
  ipc.handle(channels.goToNode, (value) => {
    const stack = current()
    if (!stack || typeof value !== 'number' || !stack.nodes[value]) {
      throw new TypeError(`${channels.goToNode} expects a node of the current stack`)
    }
    goToNode(stack, value)
  })
  ipc.handle(channels.switch, (value) => switchTo(parseStackId(channels.switch, value)))
  ipc.handle(channels.create, () => {
    const cur = current()
    // An empty current stack in a tab already is a new one.
    if (cur && cur.rootId === null && tabOfStack.has(cur.id)) return
    openNewStack()
  })
  ipc.handle(channels.close, (value) => {
    const stack = parseStackId(channels.close, value)
    const wasCurrent = stack.id === currentId
    closeStack(stack)
    const next = byRecentUse()[0]
    if (wasCurrent && next) switchTo(next)
    else if (wasCurrent && settings.get().newStackPage !== null) openNewStack()
    changed()
  })
  ipc.handle(channels.outline, (value) => {
    if (typeof value !== 'string') throw new TypeError(`${channels.outline} expects a name`)
    const name = value.replace(/^@/, '')
    const stack = [...stacks.values()].find((s) => s.name === name)
    return stack ? outline(stack) : null
  })
  ipc.handle(channels.settings, () => settings.get())
  ipc.handle(channels.updateSettings, (value) => {
    settings.set(parseStacksSettings(value))
    return settings.get()
  })

  // Restore: only the current stack gets a tab now, at its active page. Without one, a new
  // stack opens on the new-stack page.
  const restored = current()
  if (restored && restored.activeId !== null) switchTo(restored)
  else if (settings.get().newStackPage !== null) openNewStack()
}
