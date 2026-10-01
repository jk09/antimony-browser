import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'
import type { HistoryResolver, PageEvent, TabControls } from '../navigation/main'
import type { StacksState } from './ipc'

let userData = ''
const quitListeners: (() => void)[] = []
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: (_: string, listener: () => void) => quitListeners.push(listener),
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

function setup(dir = mkdtempSync(join(tmpdir(), 'antimony-stacks-'))) {
  userData = dir
  tabs = new FakeTabs()
  quitListeners.length = 0
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const send = vi.fn()
  register({
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send },
  } as unknown as MainContext)
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
  return { call, state, send, nav, title, visit, rowsOf, activeTitle, idOf, dir }
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
    const { call, visit, state } = setup()
    call(channels.create)
    expect(tabs.calls).toEqual(['create 1 active'])
    call(channels.create)
    expect(tabs.calls).toEqual(['create 1 active'])
    expect(state().current).toMatchObject({ name: '', rows: [] })
    visit(1, 'First')
    expect(state().stacks).toHaveLength(1)
    expect(state().current!.name).toBe('first')
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
    expect(state()).toEqual({ current: null, stacks: [] })
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
