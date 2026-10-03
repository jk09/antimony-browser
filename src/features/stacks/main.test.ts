import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import type { MainContext } from '../../app/main/features'
import type { HistoryResolver, PageEvent, TabControls } from '../navigation/main'
import type { StacksState } from './ipc'

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
vi.mock('../history/main', () => ({
  onHistoryCleared: (listener: (all: boolean) => void) => {
    clearedListener = listener
    return () => {}
  },
}))

const { register } = await import('./main')
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
    expect(rowsOf()).toEqual(['Home'])
    expect(state().stacks[0]!.name).toBe('home')

    call(channels.close, home.id)
    expect(tabs.calls).toContain('close 1')
    expect(state().current!.name).toBe('docs')
    expect(tabs.activeId).toBe(2)

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
    first.visit(1, 'Start')
    first.call(channels.create)
    expect(tabs.calls.at(-1)).toBe('create 2 https://start.example/ active')
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
})
