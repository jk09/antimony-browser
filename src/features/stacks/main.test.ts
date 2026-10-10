import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import type { MainContext } from '../../app/main/features'
import type { HistoryResolver, PageEvent, TabControls } from '../navigation/main'
import type { StackPages, StacksState } from './ipc'

let userData = ''
const quitListeners: (() => void)[] = []
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: (event: string, listener: () => void) => {
      if (event === 'will-quit') quitListeners.push(listener)
    },
  },
}))

/** Tabs without pages: records what stacks asks for; tests fire the page events. */
class FakeTabs implements TabControls {
  activeId: number | null = null
  next = 1
  open = new Set<number>()
  history = new Map<number, { urls: string[]; index: number }>()
  calls: string[] = []
  active = () => this.activeId
  ids = () => [...this.open]
  create = ({ url, activate }: { url?: string; activate: boolean }) => {
    const id = this.next++
    this.open.add(id)
    this.calls.push(`create ${id}${url ? ` ${url}` : ''}${activate ? ' active' : ''}`)
    if (activate) this.activate(id)
    return id
  }
  activate = (id: number | null) => {
    this.activeId = id
    if (id !== null) this.preparedTabs.delete(id)
    if (id !== null) fire({ tabId: id, type: 'activated', url: '' })
  }
  close = (id: number) => {
    this.calls.push(`close ${id}`)
    this.open.delete(id)
    if (this.activeId === id) this.activeId = null
  }
  load = (id: number, url: string) => {
    this.calls.push(`load ${id} ${url}`)
    return true
  }
  entries = (id: number) => this.history.get(id) ?? { urls: [], index: -1 }
  goToIndex = (id: number, index: number) => {
    this.calls.push(`goToIndex ${id} ${index}`)
  }
  /** Prepared tabs' load state, until activated. */
  preparedTabs = new Map<number, 'loading' | 'loaded' | 'failed'>()
  focused: number[] = []
  prepare = (url: string) => {
    const id = this.next++
    this.open.add(id)
    this.preparedTabs.set(id, 'loading')
    this.calls.push(`prepare ${id} ${url}`)
    return id
  }
  prepared = (id: number) => this.preparedTabs.get(id) ?? null
  focus = (id: number) => {
    this.focused.push(id)
  }
  sound = new Map<number, { audible: boolean; muted: boolean }>()
  audio = (id: number) =>
    this.open.has(id) ? (this.sound.get(id) ?? { audible: false, muted: false }) : null
  setMuted = (id: number, muted: boolean) => {
    this.calls.push(`setMuted ${id} ${muted}`)
  }
}

let tabs = new FakeTabs()
let pageListener: ((event: PageEvent) => void) | null = null
let resolver: HistoryResolver | null = null
let clearedListener: ((all: boolean) => void) | null = null
const fire = (event: PageEvent) => pageListener?.(event)

vi.mock('../navigation/main', () => ({
  getTabs: () => tabs,
  onPageEvent: (listener: (event: PageEvent) => void) => {
    pageListener = listener
    return () => {}
  },
  setHistoryResolver: (value: HistoryResolver) => {
    resolver = value
  },
}))
let stackOpener: { open(): void } | null = null
vi.mock('../agent/main', () => ({
  provideStackOpener: (opener: { open(): void }) => {
    stackOpener = opener
  },
}))

vi.mock('../history/main', () => ({
  onHistoryCleared: (listener: (all: boolean) => void) => {
    clearedListener = listener
    return () => {}
  },
}))

const { register, importStacks } = await import('./main')
const { channels } = await import('./ipc')

/**
 * Registers stacks on `dir`. A fresh directory gets a stacks.json with `home` (none by default,
 * so nothing opens at start); 'default' writes no file, as on a first run.
 */
function setup(dir?: string, home: string | null = null) {
  if (dir === undefined) {
    dir = mkdtempSync(join(tmpdir(), 'antimony-stacks-'))
    if (home !== 'default') {
      writeFileSync(
        join(dir, 'stacks.json'),
        JSON.stringify({ version: 2, current: null, stacks: [], home }),
      )
    }
  }
  userData = dir
  tabs = new FakeTabs()
  quitListeners.length = 0
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const send = vi.fn()
  const fileMenu: MenuItemConstructorOptions[] = []
  let onInput: ((event: { preventDefault(): void }, input: object) => void) | null = null
  let onBlur: (() => void) | null = null
  register({
    window: {
      on: (_: string, listener: () => void) => (onBlur = listener),
      webContents: {
        focus: () => {},
        on: (_: string, listener: typeof onInput) => (onInput = listener),
      },
    },
    browsingSession: {},
    fileMenu,
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send },
  } as unknown as MainContext)
  /** Presses Ctrl/Cmd+`key` in the chrome UI; returns whether the key was taken. */
  const press = (key: string, input: object = {}) => {
    const preventDefault = vi.fn()
    onInput!(
      { preventDefault },
      {
        type: 'keyDown',
        key,
        control: process.platform !== 'darwin',
        meta: process.platform === 'darwin',
        alt: false,
        shift: false,
        isAutoRepeat: false,
        ...input,
      },
    )
    return preventDefault.mock.calls.length > 0
  }
  const blur = () => onBlur!()
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  const state = () => call(channels.state) as StacksState
  const nav = (tabId: number, url: string, entry: 'new' | 'back' | 'replaced' = 'new') =>
    fire({ tabId, type: 'navigated', url, status: 200, transition: 'link', entry })
  const title = (tabId: number, value: string) => fire({ tabId, type: 'title', title: value })
  const rowsOf = () => state().current!.rows.map((row) => `${'.'.repeat(row.depth)}${row.title}`)
  const activeTitle = () => {
    const current = state().current!
    return current.rows.find((row) => row.id === current.activeId)?.title
  }
  const idOf = (name: string) => state().current!.rows.find((row) => row.title === name)!.id
  /** Opens a page by typing it: the first one creates the tab, as navigation:go does. */
  const visit = (tabId: number, name: string) => {
    vi.advanceTimersByTime(1000)
    nav(tabId, `https://site.example/${name}`)
    title(tabId, name)
  }
  return {
    call,
    state,
    send,
    nav,
    title,
    visit,
    rowsOf,
    activeTitle,
    idOf,
    dir,
    fileMenu,
    press,
    blur,
  }
}

describe('stacks main', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }))
  afterEach(() => vi.useRealTimers())

  it('builds the tree of the first tab, navigates to nodes and branches', () => {
    const { call, visit, rowsOf, activeTitle, idOf, state, nav } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'A')
    visit(1, 'B')
    visit(1, 'C')
    expect(rowsOf()).toEqual(['A', '.B', '..C'])
    expect(state().current!.name).toBe('a')

    call(channels.goToNode, idOf('A'))
    expect(tabs.calls.at(-1)).toBe('load 1 https://site.example/A')
    nav(1, 'https://site.example/A')
    expect(rowsOf()).toEqual(['A', '.B', '..C'])
    expect(activeTitle()).toBe('A')

    // Chromium still has B next to A: going to it uses the session history.
    tabs.history.set(1, {
      urls: ['https://site.example/A', 'https://site.example/B', 'https://site.example/C'],
      index: 0,
    })
    call(channels.goToNode, idOf('B'))
    expect(tabs.calls.at(-1)).toBe('goToIndex 1 1')
    nav(1, 'https://site.example/B')
    visit(1, 'C2')
    expect(rowsOf()).toEqual(['A', '.B', '..C', '..C2'])
    expect(activeTitle()).toBe('C2')
  })

  it('takes over back and forward with the tree', () => {
    const { visit, idOf, nav, call, activeTitle } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'A')
    visit(1, 'B')
    expect(resolver!.canGoBack(1)).toBe(true)
    expect(resolver!.canGoForward(1)).toBe(false)
    expect(resolver!.back(1)).toBe(true)
    expect(tabs.calls.at(-1)).toBe('load 1 https://site.example/A')
    nav(1, 'https://site.example/A')
    expect(activeTitle()).toBe('A')
    expect(resolver!.forward(1)).toBe(true)
    nav(1, 'https://site.example/B')
    expect(activeTitle()).toBe('B')
    expect(resolver!.back(99)).toBe(false)
    // A failed load forgets the target: the next navigation is a link again.
    call(channels.goToNode, idOf('A'))
    fire({ tabId: 1, type: 'failed' })
    visit(1, 'D')
    expect(activeTitle()).toBe('D')
  })

  it('starts a new stack for a new-tab link and switches between stacks', () => {
    const { call, visit, state, rowsOf } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'Home')
    fire({ tabId: 2, type: 'opened', openerId: 1, active: true })
    tabs.open.add(2)
    tabs.activate(2)
    visit(2, 'Docs')
    expect(state().stacks.map((s) => s.name)).toEqual(['docs', 'home'])
    expect(rowsOf()).toEqual(['Docs'])

    // A background tab gets a stack but stays in the background.
    fire({ tabId: 3, type: 'opened', openerId: 2, active: false })
    visit(3, 'Later')
    expect(state().current!.name).toBe('docs')

    const home = state().stacks.find((s) => s.name === 'home')!
    call(channels.switch, home.id)
    expect(tabs.activeId).toBe(1)
    // The shown page takes focus, so keys (Ctrl+Tab) keep reaching a webContents.
    expect(tabs.focused.at(-1)).toBe(1)
    expect(rowsOf()).toEqual(['Home'])
    expect(state().stacks[0]!.name).toBe('home')

    call(channels.close, home.id)
    expect(tabs.calls).toContain('close 1')
    expect(state().current!.name).toBe('docs')
    expect(tabs.activeId).toBe(2)
    expect(tabs.focused.at(-1)).toBe(2)

    expect(() => call(channels.switch, 'nope')).toThrow(TypeError)
    expect(() => call(channels.close, 42)).toThrow(TypeError)
    expect(() => call(channels.goToNode, 999)).toThrow(TypeError)
    expect(() => call(channels.goToNode, '1')).toThrow(TypeError)
    expect(() => call(channels.outline, 1)).toThrow(TypeError)
  })

  it('creates an empty stack, and the first tab without a stack adopts it', () => {
    const { call, visit, state, send } = setup()
    call(channels.create)
    expect(tabs.calls).toEqual(['create 1 active'])
    // An empty stack starts at the prompt.
    expect(send).toHaveBeenCalledWith('prompt:open', null)
    call(channels.create)
    expect(tabs.calls).toEqual(['create 1 active'])
    expect(state().current).toMatchObject({ name: '', rows: [] })
    visit(1, 'First')
    expect(state().stacks).toHaveLength(1)
    expect(state().current!.name).toBe('first')
  })

  it('lets the assistant open a new stack like Ctrl/Cmd+N', () => {
    setup()
    stackOpener!.open()
    expect(tabs.calls).toEqual(['create 1 active'])
  })

  it('closes a page with its branch; the root closes the stack', () => {
    const { call, visit, rowsOf, activeTitle, idOf, state, nav } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'A')
    visit(1, 'B')
    visit(1, 'C')
    call(channels.goToNode, idOf('A'))
    nav(1, 'https://site.example/A')
    visit(1, 'D')
    expect(rowsOf()).toEqual(['A', '.B', '..C', '.D'])

    // Another branch: nothing loads.
    const calls = tabs.calls.length
    call(channels.closeNode, idOf('B'))
    expect(rowsOf()).toEqual(['A', '.D'])
    expect(tabs.calls).toHaveLength(calls)

    // The active page: its parent loads.
    call(channels.closeNode, idOf('D'))
    expect(rowsOf()).toEqual(['A'])
    expect(activeTitle()).toBe('A')
    expect(tabs.calls.at(-1)).toBe('load 1 https://site.example/A')

    expect(() => call(channels.closeNode, 999)).toThrow(TypeError)
    expect(() => call(channels.closeNode, 'A')).toThrow(TypeError)

    call(channels.closeNode, idOf('A'))
    expect(tabs.calls.at(-1)).toBe('close 1')
    expect(state().stacks).toHaveLength(0)
  })

  it('opens new stacks at the home page, which persists', () => {
    const first = setup()
    expect(first.call(channels.home)).toBeNull()
    expect(() => first.call(channels.setHome, 'file:///etc/passwd')).toThrow(TypeError)
    expect(() => first.call(channels.setHome, 'not a url')).toThrow(TypeError)
    expect(() => first.call(channels.setHome, 42)).toThrow(TypeError)
    first.call(channels.setHome, 'https://start.example')
    expect(first.call(channels.home)).toBe('https://start.example/')

    first.call(channels.create)
    expect(tabs.calls).toEqual(['create 1 https://start.example/ active'])
    expect(tabs.focused).toEqual([1])
    first.visit(1, 'Start')
    // A second later a spare tab waits at the home page; the next new stack takes it.
    expect(tabs.calls.at(-1)).toBe('prepare 2 https://start.example/')
    first.call(channels.create)
    expect(tabs.activeId).toBe(2)
    expect(first.state().stacks).toHaveLength(2)
    quitListeners.forEach((listener) => listener())

    const again = setup(first.dir)
    expect(again.call(channels.home)).toBe('https://start.example/')
    again.call(channels.setHome, null)
    expect(again.call(channels.home)).toBeNull()
  })

  it('loads the home page in an empty current stack instead of opening another', () => {
    const { call } = setup()
    call(channels.create)
    call(channels.setHome, 'https://start.example/')
    call(channels.create)
    expect(tabs.calls).toEqual(['create 1 active', 'load 1 https://start.example/'])
  })

  it('keeps a spare tab at the home page and shows it, focused, for a new stack', () => {
    const { call, nav, title, state, rowsOf, dir } = setup(undefined, 'https://start.example/')
    expect(tabs.calls).toEqual(['create 1 https://start.example/ active'])
    vi.advanceTimersByTime(999)
    expect(tabs.calls).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(tabs.calls.at(-1)).toBe('prepare 2 https://start.example/')
    nav(1, 'https://site.example/A')
    title(1, 'A')
    // The spare isn't a stack until it's taken.
    expect(state().stacks).toHaveLength(1)
    quitListeners.forEach((listener) => listener())
    const stored = JSON.parse(readFileSync(join(dir, 'stacks.json'), 'utf8')) as {
      stacks: unknown[]
    }
    expect(stored.stacks).toHaveLength(1)

    call(channels.create)
    expect(tabs.activeId).toBe(2)
    expect(tabs.focused.at(-1)).toBe(2)
    expect(tabs.calls).toHaveLength(2)
    // Navigation reports the spare's held events once it's shown.
    nav(2, 'https://start.example/')
    title(2, 'Start')
    expect(rowsOf()).toEqual(['Start'])
    expect(state().current!.name).toBe('')
    expect(state().stacks).toHaveLength(2)

    // The next spare follows a second later and is replaced when 15 minutes old.
    vi.advanceTimersByTime(1000)
    expect(tabs.calls.at(-1)).toBe('prepare 3 https://start.example/')
    vi.advanceTimersByTime(15 * 60_000)
    expect(tabs.calls.slice(-2)).toEqual(['close 3', 'prepare 4 https://start.example/'])

    // A spare whose load failed isn't shown: the new stack loads the home page itself.
    tabs.preparedTabs.set(4, 'failed')
    call(channels.create)
    expect(tabs.calls.slice(-2)).toEqual(['close 4', 'create 5 https://start.example/ active'])
    expect(tabs.focused.at(-1)).toBe(5)
    nav(5, 'https://start.example/')

    // Nor is one older than 15 minutes whose timer didn't run (the computer slept).
    vi.advanceTimersByTime(1000)
    expect(tabs.calls.at(-1)).toBe('prepare 6 https://start.example/')
    vi.setSystemTime(Date.now() + 16 * 60_000)
    call(channels.create)
    expect(tabs.calls.slice(-2)).toEqual(['close 6', 'create 7 https://start.example/ active'])
  })

  it('replaces the spare when the home page changes and closes it when cleared', () => {
    const { call } = setup(undefined, 'https://start.example/')
    vi.advanceTimersByTime(1000)
    expect(tabs.calls.at(-1)).toBe('prepare 2 https://start.example/')
    call(channels.setHome, 'https://start.example/')
    vi.advanceTimersByTime(1000)
    expect(tabs.calls.at(-1)).toBe('prepare 2 https://start.example/')
    call(channels.setHome, 'https://other.example/')
    expect(tabs.calls.at(-1)).toBe('close 2')
    vi.advanceTimersByTime(1000)
    expect(tabs.calls.at(-1)).toBe('prepare 3 https://other.example/')
    call(channels.setHome, null)
    expect(tabs.calls.at(-1)).toBe('close 3')
    vi.advanceTimersByTime(60 * 60_000)
    expect(tabs.calls.at(-1)).toBe('close 3')
  })

  it('fills an empty current stack with the spare', () => {
    const { call, state } = setup()
    call(channels.create)
    call(channels.setHome, 'https://start.example/')
    vi.advanceTimersByTime(1000)
    call(channels.create)
    expect(tabs.calls).toEqual(['create 1 active', 'prepare 2 https://start.example/', 'close 1'])
    expect(tabs.activeId).toBe(2)
    expect(tabs.focused).toEqual([2])
    expect(state().stacks).toHaveLength(1)
  })

  it('opens a new stack at the default home page at start and after the last one closes', () => {
    const { call, nav, title, state, rowsOf } = setup(undefined, 'default')
    expect(call(channels.home)).toBe('https://www.bing.com/')
    expect(tabs.calls).toEqual(['create 1 https://www.bing.com/ active'])
    nav(1, 'https://www.bing.com/')
    title(1, 'Bing')
    fire({ tabId: 1, type: 'loaded', url: 'https://www.bing.com/' })
    expect(rowsOf()).toEqual(['Bing'])
    // Named after the first page reached from the home page, not the home page.
    expect(state().current!.name).toBe('')
    nav(1, 'https://site.example/Rust')
    title(1, 'Rust')
    expect(rowsOf()).toEqual(['Bing', '.Rust'])
    expect(state().current!.name).toBe('rust')
    expect(state().stacks[0]!.rootTitle).toBe('Rust')

    // A link-opened stack doesn't load the home page.
    tabs.open.add(tabs.next++)
    fire({ tabId: 2, type: 'opened', openerId: 1, active: false })
    expect(tabs.calls).toHaveLength(1)

    for (const stack of state().stacks) call(channels.close, stack.id)
    expect(tabs.calls.at(-1)).toBe('create 3 https://www.bing.com/ active')
    expect(state().stacks).toHaveLength(1)
  })

  it('opens new stacks at the default home page in profiles that saved none before version 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'antimony-stacks-'))
    writeFileSync(
      join(dir, 'stacks.json'),
      JSON.stringify({ current: null, stacks: [], home: null }),
    )
    const { call } = setup(dir)
    expect(call(channels.home)).toBe('https://www.bing.com/')
    expect(tabs.calls).toEqual(['create 1 https://www.bing.com/ active'])
    call(channels.setHome, null)
    quitListeners.forEach((listener) => listener())

    // Cleared after the upgrade, it stays cleared.
    expect(setup(dir).call(channels.home)).toBeNull()
  })

  it('opens nothing at start or after the last stack without a home page', () => {
    const { call, state } = setup()
    expect(tabs.calls).toEqual([])
    call(channels.create)
    call(channels.close, state().current!.id)
    expect(state().stacks).toEqual([])
    expect(tabs.calls).toEqual(['create 1 active', 'close 1'])
  })

  it('sends Ctrl/Cmd+R, +N and +W to the UI and lists them in the File menu', () => {
    const { press, send, fileMenu } = setup()
    expect(fileMenu.map((item) => [item.label, item.accelerator])).toEqual([
      ['Reload Page', 'CmdOrCtrl+R'],
      ['New Stack', 'CmdOrCtrl+N'],
      ['Close Page', 'CmdOrCtrl+W'],
      ['Focus Stack', 'CmdOrCtrl+E'],
      ['Next Stack', 'Ctrl+Tab'],
      ['Previous Stack', 'Ctrl+Shift+Tab'],
    ])
    expect(press('r')).toBe(true)
    expect(press('n')).toBe(true)
    expect(press('w')).toBe(true)
    expect(press('e')).toBe(true)
    expect(press('b')).toBe(false)
    expect(send.mock.calls.filter(([channel]) => channel === channels.command)).toEqual([
      [channels.command, 'reload'],
      [channels.command, 'new'],
      [channels.command, 'close-page'],
      [channels.command, 'focus-tree'],
    ])
  })

  it('sends the Ctrl+Tab cycle to the UI: steps, then end on Ctrl up or cancel', () => {
    const { press, send, blur, fileMenu } = setup()
    const ctrl = { control: true, meta: false }
    const commands = () =>
      send.mock.calls.filter(([channel]) => channel === channels.command).map(([, name]) => name)
    const release = () => press('Control', { type: 'keyUp', control: false, meta: false })

    // Escape and Ctrl up before any cycle reach the page untouched.
    expect(press('Escape', { control: false, meta: false })).toBe(false)
    expect(release()).toBe(false)
    expect(commands()).toEqual([])

    // Ctrl+Tab passes on: consumed, Chromium would drop the key-up of Ctrl.
    expect(press('Tab', ctrl)).toBe(false)
    expect(press('Tab', { ...ctrl, isAutoRepeat: true })).toBe(false)
    expect(press('Tab', { ...ctrl, shift: true })).toBe(false)
    expect(release()).toBe(false)
    expect(commands()).toEqual(['cycle-next', 'cycle-next', 'cycle-previous', 'cycle-end'])

    send.mockClear()
    press('Tab', ctrl)
    expect(press('Escape', { control: true, meta: false })).toBe(true)
    release()
    press('Tab', ctrl)
    blur()
    blur()
    expect(commands()).toEqual(['cycle-next', 'cycle-cancel', 'cycle-next', 'cycle-cancel'])

    // The menu only shows the keys: registered, they'd also run the one-step menu click.
    const cycleItems = fileMenu.filter((item) => item.accelerator?.includes('Tab'))
    expect(cycleItems.map((item) => item.registerAccelerator)).toEqual([false, false])
    send.mockClear()
    ;(fileMenu.find((item) => item.label === 'Previous Stack')!.click as () => void)()
    expect(commands()).toEqual(['cycle-previous', 'cycle-end'])
  })

  it('serves outlines by name and publishes changes once per burst', async () => {
    const { call, visit, send, title } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'Home')
    visit(1, 'Page')
    expect(call(channels.outline, '@home')).toContain(
      '- Page — https://site.example/Page ← current',
    )
    expect(call(channels.outline, 'unknown')).toBeNull()
    await vi.advanceTimersByTimeAsync(20)
    send.mockClear()
    title(1, 'Page 2')
    title(1, 'Page 3')
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toBe(channels.stateChanged)
  })

  it('lists every stack’s pages with refs and opens a page of another stack', () => {
    const { call, visit, state } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'Home')
    visit(1, 'Page')
    fire({ tabId: 2, type: 'opened', openerId: 1, active: true })
    tabs.open.add(2)
    tabs.activate(2)
    visit(2, 'Docs')
    const pages = call(channels.pages) as StackPages[]
    expect(pages.map((stack) => [stack.name, stack.rows.map((row) => row.ref)])).toEqual([
      ['docs', ['docs']],
      ['home', ['home', 'page']],
    ])
    const home = pages[1]!
    expect(home.activeId).toBe(home.rows[1]!.id)
    expect(call(channels.outline, '@home/page')).toBe(
      'Page @home/page in navigation stack @home (the stack’s current page):\nPage — https://site.example/Page',
    )
    expect(call(channels.outline, 'home/nope')).toBeNull()

    // Another stack's page: switch, then load it from the tree.
    tabs.history.set(1, {
      urls: ['https://site.example/Home', 'https://site.example/Page'],
      index: 1,
    })
    tabs.calls.length = 0
    call(channels.openPage, { stackId: home.id, nodeId: home.rows[0]!.id })
    expect(tabs.activeId).toBe(1)
    expect(tabs.calls).toEqual(['goToIndex 1 0'])
    expect(tabs.focused.at(-1)).toBe(1)
    expect(state().current!.name).toBe('home')

    // The page already shown isn't reloaded.
    const docs = pages[0]!
    call(channels.switch, docs.id)
    tabs.calls.length = 0
    call(channels.openPage, { stackId: docs.id, nodeId: docs.rows[0]!.id })
    expect(tabs.calls).toEqual([])
    expect(tabs.focused.at(-1)).toBe(2)

    expect(() => call(channels.openPage, { stackId: 'nope', nodeId: 1 })).toThrow(TypeError)
    expect(() => call(channels.openPage, { stackId: docs.id, nodeId: 999 })).toThrow(TypeError)
    expect(() => call(channels.openPage, { stackId: docs.id, nodeId: '1' })).toThrow(TypeError)
    expect(() => call(channels.openPage, null)).toThrow(TypeError)
  })

  it('shows which stacks play sound and mutes a stack without switching', async () => {
    const { call, visit, state, send } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'Video')
    fire({ tabId: 2, type: 'opened', openerId: 1, active: false })
    tabs.open.add(2)
    visit(2, 'Music')
    const audioOf = () => Object.fromEntries(state().stacks.map((s) => [s.name, s.audio]))
    expect(audioOf()).toEqual({ video: null, music: null })

    await vi.advanceTimersByTimeAsync(5000)
    send.mockClear()
    const written = readFileSync(join(userData, 'stacks.json'), 'utf8')
    tabs.sound.set(2, { audible: true, muted: false })
    fire({ tabId: 2, type: 'audio', audible: true, muted: false })
    await vi.advanceTimersByTimeAsync(20)
    expect(send).toHaveBeenCalledWith(channels.stateChanged, expect.anything())
    expect(audioOf()).toEqual({ video: null, music: 'playing' })
    tabs.sound.set(2, { audible: true, muted: true })
    expect(audioOf()).toEqual({ video: null, music: 'muted' })
    // A muted tab that went quiet keeps its indicator, so it can be unmuted.
    tabs.sound.set(2, { audible: false, muted: true })
    expect(audioOf()).toEqual({ video: null, music: 'muted' })
    // Sound isn't stored.
    vi.advanceTimersByTime(5000)
    expect(readFileSync(join(userData, 'stacks.json'), 'utf8')).toBe(written)

    const music = state().stacks.find((s) => s.name === 'music')!
    call(channels.setMuted, { stackId: music.id, muted: false })
    expect(tabs.calls.at(-1)).toBe('setMuted 2 false')
    expect(state().current!.name).toBe('video')
    expect(tabs.activeId).toBe(1)

    for (const bad of [
      undefined,
      music.id,
      { stackId: music.id },
      { stackId: music.id, muted: 'yes' },
      { stackId: 'nope', muted: true },
    ]) {
      expect(() => call(channels.setMuted, bad)).toThrow(TypeError)
    }
  })

  it('persists stacks and restores only the current one in a tab', () => {
    const first = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    first.visit(1, 'One')
    first.visit(1, 'Two')
    fire({ tabId: 2, type: 'opened', openerId: 1, active: true })
    first.visit(2, 'Other')
    quitListeners.forEach((listener) => listener())
    const saved = JSON.parse(readFileSync(join(first.dir, 'stacks.json'), 'utf8'))
    expect(saved.stacks).toHaveLength(2)

    const again = setup(first.dir)
    expect(tabs.calls).toEqual(['create 1 https://site.example/Other active'])
    again.nav(1, 'https://site.example/Other')
    expect(again.rowsOf()).toEqual(['Other'])
    const one = again.state().stacks.find((s) => s.name === 'one')!
    again.call(channels.switch, one.id)
    expect(tabs.calls.at(-1)).toBe('create 2 https://site.example/Two active')
    again.nav(2, 'https://site.example/Two')
    expect(again.rowsOf()).toEqual(['One', '.Two'])
  })

  it('moves a corrupt stacks.json aside', () => {
    const dir = mkdtempSync(join(tmpdir(), 'antimony-stacks-'))
    writeFileSync(join(dir, 'stacks.json'), JSON.stringify({ stacks: [{ id: 'x' }] }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { state } = setup(dir)
    // The fallback has no stacks and the default home page, so one opens there.
    expect(tabs.calls).toEqual(['create 1 https://www.bing.com/ active'])
    expect(state().stacks).toHaveLength(1)
  })

  it('clears stacks with all of the browsing history', () => {
    const { visit, state, rowsOf } = setup()
    tabs.open.add(1)
    tabs.activeId = 1
    visit(1, 'One')
    visit(1, 'Two')
    fire({ tabId: 2, type: 'opened', openerId: 1, active: false })
    visit(2, 'Other')
    clearedListener!(false)
    expect(state().stacks).toHaveLength(2)
    clearedListener!(true)
    expect(state().stacks).toHaveLength(1)
    expect(rowsOf()).toEqual(['Two'])
    expect(tabs.calls).toContain('close 2')
  })

  describe('importStacks', () => {
    const group = (name: string, lastAt: number, titles: string[]) => ({
      name,
      lastAt,
      pages: titles.map((title, n) => ({
        url: `https://${title.toLowerCase()}.example/${name}`,
        title,
        at: lastAt - (titles.length - n) * 1000,
      })),
    })

    it('adds unopened stacks behind the user’s own, never current, and persists them', () => {
      const dir = mkdtempSync(join(tmpdir(), 'antimony-stacks-'))
      const { state, visit } = setup(dir)
      tabs.open.add(1)
      tabs.activeId = 1
      visit(1, 'Mine')
      const before = tabs.calls.length

      expect(
        importStacks([
          group('Alpha Beta', 1000, ['Alpha', 'Beta']),
          group('gamma', 9000, ['Gamma', 'Delta']),
          group('solo', 50, ['Solo']),
        ]),
      ).toEqual({ created: 2, skipped: 1 })
      expect(tabs.calls).toHaveLength(before)
      expect(
        state()
          .stacks.map((stack) => stack.name)
          .slice(1),
      ).toEqual(['gamma', 'alpha-beta'])
      expect(state().current!.id).toBe(state().stacks[0]!.id)
      expect(state().stacks.map((stack) => stack.pages)).toEqual([1, 2, 2])

      quitListeners.forEach((listener) => listener())
      const saved = JSON.parse(readFileSync(join(dir, 'stacks.json'), 'utf8'))
      expect(saved.stacks.filter((stack: { imported?: number }) => stack.imported)).toHaveLength(2)
    })

    it('skips groups mostly imported before, adds a partly new one, and opens an imported stack at its last page', () => {
      const { state, call } = setup()
      importStacks([group('alpha', 5000, ['Alpha', 'Beta'])])
      expect(importStacks([group('alpha', 5000, ['Alpha', 'Beta'])])).toEqual({
        created: 0,
        skipped: 1,
      })
      expect(importStacks([group('alpha', 5000, ['Alpha', 'Beta', 'Gamma', 'Delta'])])).toEqual({
        created: 1,
        skipped: 0,
      })
      const id = state().stacks.find((stack) => stack.name === 'alpha')!.id
      call(channels.switch, id)
      expect(tabs.calls).toContain('create 1 https://beta.example/alpha active')
      expect(state().current!.rows.map((row) => row.title)).toEqual(['Alpha', 'Beta'])
    })

    it('stops at 50 stacks without closing the user’s own', () => {
      const { state } = setup()
      const many = Array.from({ length: 60 }, (_, n) =>
        group(`g${n}`, 1000 * (n + 1), [`T${n}a`, `T${n}b`]),
      )
      expect(importStacks(many)).toEqual({ created: 50, skipped: 10 })
      expect(state().stacks).toHaveLength(50)
    })
  })
})
