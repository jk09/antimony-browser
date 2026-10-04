import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { onHistoryCleared } from '../history/main'
import { getTabs, onPageEvent, setHistoryResolver, type PageEvent } from '../navigation/main'
import { channels as promptChannels } from '../prompt/ipc'
import { channels, DEFAULT_HOME, type Stack, type StackCommand, type StacksState } from './ipc'
import { cycleKeyFor, stackCommandFor } from './shared/keys'
import { parseStoredStacks, STACKS_FILE_VERSION, type StoredStacks } from './shared/stored'
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
  removeBranch,
  rows,
  setTitle,
  trimToActive,
} from './shared/tree'

const PUBLISH_DELAY_MS = 16
const MAX_HOME_LENGTH = 2048
/** The spare tab is prepared this long after the page it follows, so it doesn't compete with it. */
const SPARE_DELAY_MS = 1000
/** An older spare is replaced: the search page it shows may be stale. */
const SPARE_MAX_AGE_MS = 15 * 60_000

/** An http(s) URL the home page may be, or null. */
function parseHome(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_HOME_LENGTH) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function register({ window, browsingSession, ipc, fileMenu }: MainContext): void {
  const tabs = getTabs()
  if (!tabs) throw new Error('stacks needs navigation to be registered first')

  const store = createJsonStore(join(app.getPath('userData'), 'stacks.json'), {
    parse: parseStoredStacks,
    fallback: (): StoredStacks => ({
      version: STACKS_FILE_VERSION,
      current: null,
      stacks: [],
      home: DEFAULT_HOME,
    }),
  })
  app.on('will-quit', () => store.flush())

  const stacks = new Map<string, Stack>(store.get().stacks.map((stack) => [stack.id, stack]))
  let currentId: string | null = store.get().current
  let home: string | null = store.get().home
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
    store.set({
      version: STACKS_FILE_VERSION,
      current: currentId,
      stacks: [...stacks.values()],
      home,
    })
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

  // A spare tab waits at the home page in the background, so a new stack shows it at once.
  // Navigation holds its events until it's shown: history and the tree don't see it before.
  let spare: { tabId: number; url: string; createdAt: number } | null = null
  let spareTimer: ReturnType<typeof setTimeout> | null = null
  const dropSpare = () => {
    if (spareTimer !== null) clearTimeout(spareTimer)
    spareTimer = null
    if (spare) tabs.close(spare.tabId)
    spare = null
  }
  const prepareSpare = () => {
    dropSpare()
    if (home === null) return
    const tabId = tabs.prepare(home)
    if (tabId === null) return
    spare = { tabId, url: home, createdAt: Date.now() }
    spareTimer = setTimeout(prepareSpare, SPARE_MAX_AGE_MS)
  }
  const scheduleSpare = () => {
    dropSpare()
    if (home !== null) spareTimer = setTimeout(prepareSpare, SPARE_DELAY_MS)
  }
  /** The spare's tab if it can be shown (current home page, fresh, not failed), else null. */
  const takeSpare = (): number | null => {
    const taken = spare
    spare = null
    if (!taken) return null
    const usable =
      taken.url === home &&
      Date.now() - taken.createdAt <= SPARE_MAX_AGE_MS &&
      (tabs.prepared(taken.tabId) ?? 'failed') !== 'failed'
    if (usable) return taken.tabId
    tabs.close(taken.tabId)
    return null
  }

  /**
   * Starts a new stack in a new tab, or fills the empty current stack: at the home page (its root,
   * the stack named after the next page), else empty at the prompt.
   */
  const openNewStack = () => {
    const cur = current()
    // An empty current stack already is a new one; it only needs the home page.
    const empty = cur && cur.rootId === null ? cur : null
    const emptyTab = empty && tabOfStack.get(empty.id)
    if (empty && home === null) return
    const spareTab = takeSpare()
    if (spareTab !== null) {
      const stack = empty ?? addStack()
      makeCurrent(stack)
      stack.startRoot = true
      // Shown before the empty stack's tab closes, so the placeholder doesn't flash.
      bind(stack, spareTab)
      tabs.activate(spareTab)
      if (emptyTab !== undefined && emptyTab !== null) {
        stackOfTab.delete(emptyTab)
        tabs.close(emptyTab)
      }
      tabs.focus(spareTab)
      scheduleSpare()
      changed()
      return
    }
    if (emptyTab !== undefined && emptyTab !== null && home !== null) {
      empty!.startRoot = true
      tabs.load(emptyTab, home, 'typed')
      tabs.focus(emptyTab)
      scheduleSpare()
      return
    }
    const stack = empty ?? addStack()
    makeCurrent(stack)
    // Without a home page the new stack starts at the prompt.
    if (home === null) {
      window.webContents.focus()
      ipc.send(promptChannels.open, null)
    } else stack.startRoot = true
    const tabId = tabs.create({
      activate: true,
      ...(home !== null && { url: home, transition: 'typed' as const }),
    })
    bind(stack, tabId)
    if (home !== null) {
      tabs.focus(tabId)
      scheduleSpare()
    }
    changed()
  }
  ipc.handle(channels.create, openNewStack)
  const closeAndSwitch = (stack: Stack) => {
    const wasCurrent = stack.id === currentId
    closeStack(stack)
    const next = byRecentUse()[0]
    if (wasCurrent && next) switchTo(next)
    // The last stack closed: a new one at the home page.
    else if (wasCurrent && home !== null) openNewStack()
    changed()
  }
  ipc.handle(channels.close, (value) => closeAndSwitch(parseStackId(channels.close, value)))
  ipc.handle(channels.closeNode, (value) => {
    const stack = current()
    if (!stack || typeof value !== 'number' || !stack.nodes[value]) {
      throw new TypeError(`${channels.closeNode} expects a node of the current stack`)
    }
    if (value === stack.rootId) {
      closeAndSwitch(stack)
      return
    }
    if (removeBranch(stack, value)) goToNode(stack, stack.activeId!)
    changed()
  })
  ipc.handle(channels.home, () => home)
  ipc.handle(channels.setHome, (value) => {
    const url = value === null ? null : parseHome(value)
    if (value !== null && url === null) {
      throw new TypeError(`${channels.setHome} expects an http(s) URL or null`)
    }
    if (url !== home) {
      home = url
      scheduleSpare()
    }
    changed()
  })

  // Ctrl/Cmd+R, +N, +W and +E go to the UI, which runs them like its buttons (and knows whether the
  // assistant runs). They're caught before the page or the menu sees them, like Ctrl/Cmd+B:
  // a page view doesn't always pass them on to the menu, and Chromium's own Ctrl+R mustn't run.
  const command = (name: StackCommand) => {
    window.webContents.focus()
    ipc.send(channels.command, name)
  }
  fileMenu.push(
    {
      id: 'stacks-reload',
      label: 'Reload Page',
      accelerator: 'CmdOrCtrl+R',
      click: () => command('reload'),
    },
    {
      id: 'stacks-new',
      label: 'New Stack',
      accelerator: 'CmdOrCtrl+N',
      click: () => command('new'),
    },
    {
      id: 'stacks-close-page',
      label: 'Close Page',
      accelerator: 'CmdOrCtrl+W',
      click: () => command('close-page'),
    },
    {
      id: 'stacks-focus-tree',
      label: 'Focus Stack',
      accelerator: 'CmdOrCtrl+E',
      click: () => command('focus-tree'),
    },
    // From the menu there's no Ctrl to release: one step, then switch. The keys are only shown
    // here; before-input-event handles them (registered, they would also run this click).
    {
      id: 'stacks-next',
      label: 'Next Stack',
      accelerator: 'Ctrl+Tab',
      registerAccelerator: false,
      click: () => cycleStep('cycle-next', true),
    },
    {
      id: 'stacks-previous',
      label: 'Previous Stack',
      accelerator: 'Ctrl+Shift+Tab',
      registerAccelerator: false,
      click: () => cycleStep('cycle-previous', true),
    },
  )

  // Ctrl+[Shift+]Tab: the UI keeps the stacks in most-recently-used order and the highlight; main
  // only knows whether a cycle is open, to end it when Ctrl goes up and cancel it on Escape or
  // when the window loses focus. Focus stays where it is (the switch moves it to the page).
  let cycling = false
  const cycleStep = (name: 'cycle-next' | 'cycle-previous', end: boolean) => {
    cycling = !end
    ipc.send(channels.command, name)
    if (end) ipc.send(channels.command, 'cycle-end')
  }
  const finishCycle = (name: 'cycle-end' | 'cycle-cancel') => {
    if (!cycling) return
    cycling = false
    ipc.send(channels.command, name)
  }
  window.on('blur', () => finishCycle('cycle-cancel'))

  const catchKeys = (contents: Electron.WebContents) =>
    contents.on('before-input-event', (event, input) => {
      const cycle = cycleKeyFor(input)
      // Ctrl+Tab isn't consumed: after a consumed key-down Chromium drops every key event up to
      // the next key-down, so Ctrl going up would never arrive. Pages don't act on Ctrl+Tab.
      if (cycle === 'next' || cycle === 'previous') {
        cycleStep(cycle === 'next' ? 'cycle-next' : 'cycle-previous', false)
        return
      }
      // The key-up of Ctrl isn't consumed: pages keep seeing their modifier state.
      if (cycle === 'release') return finishCycle('cycle-end')
      if (cycle === 'escape' && cycling) {
        event.preventDefault()
        return finishCycle('cycle-cancel')
      }
      const name = stackCommandFor(input, process.platform)
      if (name === null) return
      event.preventDefault()
      command(name)
    })
  catchKeys(window.webContents)
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session === browsingSession) catchKeys(contents)
  })
  ipc.handle(channels.outline, (value) => {
    if (typeof value !== 'string') throw new TypeError(`${channels.outline} expects a name`)
    const name = value.replace(/^@/, '')
    const stack = [...stacks.values()].find((s) => s.name === name)
    return stack ? outline(stack) : null
  })

  // Restore: only the current stack gets a tab now, at its active page. Without one, a new
  // stack opens at the home page.
  const restored = current()
  if (restored && restored.activeId !== null) switchTo(restored)
  else if (home !== null) openNewStack()
  if (spareTimer === null) scheduleSpare()
}
