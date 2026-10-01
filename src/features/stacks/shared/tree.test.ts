import { describe, expect, it } from 'vitest'
import type { Stack } from '../ipc'
import {
  backTarget,
  collapse,
  deriveName,
  forwardTarget,
  navigated,
  newStack,
  outline,
  prune,
  rows,
  setTitle,
  slug,
  trimToActive,
  uniqueName,
  type CollapsedItem,
} from './tree'

const A = 'https://a.example/'
const B = 'https://a.example/b'
const C = 'https://a.example/c'
const C2 = 'https://a.example/c2'

let clock = 0
const go = (stack: Stack, url: string, entry: 'new' | 'replaced' | 'back' | 'forward' = 'new') =>
  navigated(stack, { url, entry, target: null }, ++clock)
const goTo = (stack: Stack, target: number, url: string) =>
  navigated(stack, { url, entry: 'new', target }, ++clock)
const shape = (stack: Stack) => rows(stack).map((row) => `${'.'.repeat(row.depth)}${row.url}`)
const idOf = (stack: Stack, url: string) => rows(stack).find((row) => row.url === url)!.id

describe('stack tree', () => {
  it('builds A → B → C from links, C active', () => {
    const stack = newStack('s', 0)
    go(stack, A)
    go(stack, B)
    go(stack, C)
    expect(shape(stack)).toEqual([A, `.${B}`, `..${C}`])
    expect(stack.activeId).toBe(idOf(stack, C))
  })

  it('going to a node keeps every node in place and only moves the active one', () => {
    const stack = newStack('s', 0)
    for (const url of [A, B, C]) go(stack, url)
    goTo(stack, idOf(stack, A), A)
    expect(shape(stack)).toEqual([A, `.${B}`, `..${C}`])
    expect(stack.activeId).toBe(idOf(stack, A))
    goTo(stack, idOf(stack, B), B)
    expect(stack.activeId).toBe(idOf(stack, B))
  })

  it('branches when going back to B and following another link', () => {
    const stack = newStack('s', 0)
    for (const url of [A, B, C]) go(stack, url)
    goTo(stack, idOf(stack, B), B)
    go(stack, C2)
    expect(shape(stack)).toEqual([A, `.${B}`, `..${C}`, `..${C2}`])
    expect(stack.activeId).toBe(idOf(stack, C2))
    expect(rows(stack).map((row) => row.last)).toEqual([true, true, false, true])
  })

  it('reuses a child with the same page, and stays on the same page for fragments and reloads', () => {
    const stack = newStack('s', 0)
    for (const url of [A, B]) go(stack, url)
    goTo(stack, idOf(stack, A), A)
    go(stack, `${B}#top`)
    expect(shape(stack)).toEqual([A, `.${B}#top`])
    go(stack, `${B}#other`)
    go(stack, `${B}#other`, 'replaced')
    expect(shape(stack)).toEqual([A, `.${B}#other`])
  })

  it('handles back and forward started by the page itself', () => {
    const stack = newStack('s', 0)
    for (const url of [A, B, C]) go(stack, url)
    go(stack, A, 'back')
    expect(stack.activeId).toBe(idOf(stack, A))
    go(stack, B, 'forward')
    expect(stack.activeId).toBe(idOf(stack, B))
    expect(shape(stack)).toEqual([A, `.${B}`, `..${C}`])
  })

  it('replaceState and redirects update the active node', () => {
    const stack = newStack('s', 0)
    go(stack, A)
    go(stack, `${A}?page=2`, 'replaced')
    expect(shape(stack)).toEqual([`${A}?page=2`])
  })

  it('back goes to the parent, forward to the most recently visited child', () => {
    const stack = newStack('s', 0)
    for (const url of [A, B, C]) go(stack, url)
    goTo(stack, idOf(stack, B), B)
    go(stack, C2)
    goTo(stack, idOf(stack, B), B)
    expect(backTarget(stack)).toBe(idOf(stack, A))
    expect(forwardTarget(stack)).toBe(idOf(stack, C2))
    goTo(stack, idOf(stack, C), C)
    goTo(stack, idOf(stack, B), B)
    expect(forwardTarget(stack)).toBe(idOf(stack, C))
    goTo(stack, idOf(stack, A), A)
    expect(backTarget(stack)).toBeNull()
    goTo(stack, idOf(stack, C), C)
    expect(forwardTarget(stack)).toBeNull()
  })

  it('names stacks once from the root title, or its host', () => {
    expect(slug('Hacker News — Search!')).toBe('hacker-news-search')
    expect(slug('Ünïcode')).toBe('unicode')
    expect(slug('日本語')).toBe('')
    expect(slug('x'.repeat(40))).toHaveLength(32)
    expect(uniqueName('hacker-news', new Set(['hacker-news', 'hacker-news-2']))).toBe(
      'hacker-news-3',
    )
    expect(uniqueName('y'.repeat(32), new Set(['y'.repeat(32)]))).toBe(`${'y'.repeat(30)}-2`)

    const stack = newStack('s', 0)
    expect(deriveName(stack, new Set(), true)).toBe(false)
    go(stack, 'https://www.example.com/x')
    expect(deriveName(stack, new Set(), false)).toBe(false)
    expect(deriveName(stack, new Set(['example-com']), true)).toBe(true)
    expect(stack.name).toBe('example-com-2')
    setTitle(stack, 'Later title')
    expect(deriveName(stack, new Set(), true)).toBe(false)
    expect(stack.name).toBe('example-com-2')

    const titled = newStack('t', 0)
    go(titled, A)
    setTitle(titled, 'Hacker News')
    go(titled, B)
    setTitle(titled, 'Not the root')
    deriveName(titled, new Set(), false)
    expect(titled.name).toBe('hacker-news')
  })

  it('collapses long trees around the active row', () => {
    const show = (items: CollapsedItem[]) =>
      items.map((item) => (item.kind === 'row' ? item.index : `…${item.from}-${item.to}`))
    expect(show(collapse(5, 4, 8))).toEqual([0, 1, 2, 3, 4])
    // Active in the tail: root, ellipsis, the last rows.
    expect(show(collapse(20, 19, 8))).toEqual([0, '…1-13', 14, 15, 16, 17, 18, 19])
    expect(show(collapse(20, 0, 8))).toEqual([0, '…1-13', 14, 15, 16, 17, 18, 19])
    // Active in the middle: rows up to it, then a second ellipsis.
    expect(show(collapse(20, 10, 8))).toEqual([0, '…1-5', 6, 7, 8, 9, 10, '…11-19'])
    // Active near the top: no first ellipsis.
    expect(show(collapse(20, 3, 8))).toEqual([0, 1, 2, 3, 4, 5, 6, '…7-19'])
    expect(show(collapse(20, 10, 2))).toEqual([0, '…1-9', 10, '…11-19'])
  })

  it('outlines the stack for the model, keeping the path to the active page', () => {
    const stack = newStack('s', 0)
    stack.name = 'docs'
    go(stack, A)
    setTitle(stack, 'Home')
    go(stack, B)
    goTo(stack, idOf(stack, A), A)
    go(stack, C)
    setTitle(stack, 'Cee')
    expect(outline(stack)).toBe(
      [
        'Navigation stack @docs (3 pages, tree of followed links):',
        `- Home — ${A}`,
        `  - (untitled) — ${B}`,
        `  - Cee — ${C} ← current`,
      ].join('\n'),
    )
    expect(outline(stack, 2).split('\n').slice(1)).toEqual([
      `- Home — ${A}`,
      `  - Cee — ${C} ← current`,
      '… 1 more pages not shown',
    ])
  })

  it('prunes old leaves off the active path, and trims to the active node', () => {
    const stack = newStack('s', 0)
    go(stack, A)
    for (let i = 0; i < 5; i++) {
      go(stack, `${A}leaf${i}`)
      goTo(stack, idOf(stack, A), A)
    }
    go(stack, B)
    prune(stack, 4)
    expect(shape(stack)).toEqual([A, `.${A}leaf3`, `.${A}leaf4`, `.${B}`])
    trimToActive(stack)
    expect(shape(stack)).toEqual([B])
    expect(backTarget(stack)).toBeNull()
  })
})
