// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi, idleState } from '../../../app/renderer/fake-api'
import type { StackRow, StacksState } from '../ipc'
import { maxRowsFor, StackHeader } from './StackHeader'

afterEach(cleanup)

const row = (id: number, depth: number, last = true): StackRow => ({
  id,
  url: `https://site.example/${id}`,
  title: `Page ${id}`,
  depth,
  last,
})

const state = (rows: StackRow[], activeId: number): StacksState => ({
  current: { id: 's1', name: 'page-1', rows, activeId },
  stacks: [
    { id: 's1', name: 'page-1', rootTitle: 'Page 1', pages: rows.length, audio: null },
    { id: 's2', name: 'docs', rootTitle: 'Docs', pages: 1, audio: null },
  ],
})

async function renderHeader(stacks: StacksState) {
  const fake = fakeApi({ stacks })
  render(<StackHeader />)
  await act(async () => {})
  return fake
}

const items = () =>
  within(screen.getByRole('tree', { name: 'Navigation stack' }))
    .getAllByRole('treeitem')
    .map((item) => `${item.getAttribute('aria-level')}:${item.textContent!.replace(/×$/, '')}`)

describe('StackHeader', () => {
  it('shows the stack as a tree with only the active page highlighted', async () => {
    // A → B → C, then C′ from B (C′ active).
    await renderHeader(state([row(1, 0), row(2, 1), row(3, 2, false), row(4, 2)], 4))
    expect(screen.getByRole('button', { name: /@page-1/ })).toBeTruthy()
    expect(items()).toEqual([
      '1:Page 1',
      '2:└Page 2',
      '3:├Page 3',
      '3:└Page 4https://site.example/4',
    ])
    const current = screen.getAllByRole('treeitem').filter((item) => item.ariaCurrent === 'page')
    expect(current.map((item) => item.getAttribute('aria-level'))).toEqual(['3'])
  })

  it('goes to a clicked page and moves focus with the arrow keys', async () => {
    const { api } = await renderHeader(state([row(1, 0), row(2, 1), row(3, 2)], 3))
    fireEvent.click(screen.getByText('Page 1'))
    expect(api.stacks.goToNode).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByText('Page 3'))
    expect(api.stacks.goToNode).toHaveBeenCalledTimes(1)
    const [first, second] = screen.getAllByRole('treeitem')
    first!.focus()
    fireEvent.keyDown(first!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second!, { key: 'Enter' })
    expect(api.stacks.goToNode).toHaveBeenLastCalledWith(2)
  })

  it('collapses a long stack and opens the full stack from the ellipsis', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, Math.min(i, 1)))
    await renderHeader(state(rows, 20))
    const shown = screen.getAllByRole('treeitem')
    expect(shown.length).toBeLessThanOrEqual(7)
    expect(shown[0]!.textContent).toBe('Page 1×')
    expect(shown.at(-1)!.textContent).toContain('Page 20')
    fireEvent.click(screen.getByRole('button', { name: /Show \d+ more pages/ }))
    const overlay = screen.getByRole('dialog', { name: 'Full stack' })
    expect(within(overlay).getAllByRole('treeitem')).toHaveLength(20)
    expect(document.activeElement?.textContent).toContain('Page 20')
    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Full stack' })).toBeNull()
  })

  it('limits the tree to 8 rows and 35 % of the window, at least 4', () => {
    expect(maxRowsFor(2000)).toBe(8)
    expect(maxRowsFor(440)).toBe(7)
    expect(maxRowsFor(100)).toBe(4)
  })

  it('lists, switches, creates and closes stacks; not while the assistant runs', async () => {
    const { api, emit } = await renderHeader(state([row(1, 0)], 1))
    fireEvent.click(screen.getByRole('button', { name: /@page-1/ }))
    const list = screen.getByRole('dialog', { name: 'Stacks' })
    fireEvent.click(within(list).getByRole('button', { name: /^@docsDocs/ }))
    expect(api.stacks.switch).toHaveBeenCalledWith('s2')

    fireEvent.click(screen.getByRole('button', { name: /@page-1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Close @docs' }))
    expect(api.stacks.close).toHaveBeenCalledWith('s2')
    fireEvent.click(screen.getByRole('button', { name: '+ New stack' }))
    expect(api.stacks.create).toHaveBeenCalled()

    act(() => emit.state({ ...idleState, status: 'running' }))
    fireEvent.click(screen.getByRole('button', { name: /@page-1/ }))
    expect(screen.getByText('Stop the assistant first to switch stacks')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^@docsDocs/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('reloads and opens a new stack from the buttons and the shortcuts, with hints', async () => {
    const { api, emit } = await renderHeader(state([row(1, 0), row(2, 1)], 2))
    const reload = screen.getByRole('button', { name: 'Reload page' })
    const create = screen.getByRole('button', { name: 'New stack' })
    expect(reload.title).toBe('Reload page (Ctrl+R)')
    expect(reload.getAttribute('aria-keyshortcuts')).toBe('Control+R')
    expect(create.title).toBe('New stack (Ctrl+N)')
    fireEvent.click(reload)
    expect(api.navigation.reload).toHaveBeenCalledTimes(1)
    fireEvent.click(create)
    expect(api.stacks.create).toHaveBeenCalledTimes(1)
    act(() => emit.stackCommand('reload'))
    act(() => emit.stackCommand('new'))
    expect(api.navigation.reload).toHaveBeenCalledTimes(2)
    expect(api.stacks.create).toHaveBeenCalledTimes(2)
  })

  it('closes a page from its × or Delete, and the active one with the shortcut', async () => {
    const { api, emit } = await renderHeader(state([row(1, 0), row(2, 1), row(3, 1)], 3))
    const active = screen.getByRole('button', { name: 'Close Page 3' })
    expect(active.title).toBe('Close page (Ctrl+W)')
    expect(screen.getByRole('button', { name: 'Close Page 2' }).title).toBe('Close page')
    fireEvent.click(screen.getByRole('button', { name: 'Close Page 2' }))
    expect(api.stacks.closeNode).toHaveBeenLastCalledWith(2)
    expect(api.stacks.goToNode).not.toHaveBeenCalled()
    fireEvent.keyDown(active, { key: 'Enter' })
    expect(api.stacks.goToNode).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getAllByRole('treeitem')[0]!, { key: 'Delete' })
    expect(api.stacks.closeNode).toHaveBeenLastCalledWith(1)
    act(() => emit.stackCommand('close-page'))
    expect(api.stacks.closeNode).toHaveBeenLastCalledWith(3)
  })

  it('neither closes pages nor opens stacks while the assistant runs; reload still works', async () => {
    const { api, emit } = await renderHeader(state([row(1, 0), row(2, 1)], 2))
    act(() => emit.state({ ...idleState, status: 'running' }))
    expect((screen.getByRole('button', { name: 'New stack' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(
      (screen.getByRole('button', { name: 'Close Page 2' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    act(() => emit.stackCommand('new'))
    act(() => emit.stackCommand('close-page'))
    act(() => emit.stackCommand('reload'))
    expect(api.stacks.create).not.toHaveBeenCalled()
    expect(api.stacks.closeNode).not.toHaveBeenCalled()
    expect(api.navigation.reload).toHaveBeenCalledTimes(1)
  })

  it('cycles through stacks with Ctrl+Tab, most recent first, and switches on release', async () => {
    const three: StacksState = {
      ...state([row(1, 0)], 1),
      stacks: [
        { id: 's1', name: 'page-1', rootTitle: 'Page 1', pages: 1, audio: null },
        { id: 's2', name: 'docs', rootTitle: 'Docs', pages: 1, audio: null },
        { id: 's3', name: 'news', rootTitle: 'News', pages: 1, audio: null },
      ],
    }
    const { api, emit } = await renderHeader(three)
    const switcher = screen.getByRole('button', { name: /@page-1/ })
    expect(switcher.title).toBe('All stacks (3): click to switch or search (Ctrl+Tab)')
    expect(switcher.textContent).toBe('@page-13 stacks▾')
    const highlighted = () =>
      within(screen.getByRole('dialog', { name: 'Stacks' }))
        .getAllByRole('listitem')
        .filter((item) => item.getAttribute('aria-selected') === 'true')
        .map((item) => item.textContent)

    // One Ctrl+Tab: the previous stack; focus stays where it is.
    act(() => emit.stackCommand('cycle-next'))
    expect(document.activeElement).toBe(document.body)
    expect(highlighted()).toEqual([expect.stringContaining('@docs')])
    act(() => emit.stackCommand('cycle-end'))
    expect(api.stacks.switch).toHaveBeenLastCalledWith('s2')
    expect(screen.queryByRole('dialog', { name: 'Stacks' })).toBeNull()

    // Tab, Tab wraps to the current one; Shift+Tab goes back to the oldest.
    act(() => emit.stackCommand('cycle-next'))
    act(() => emit.stackCommand('cycle-next'))
    expect(highlighted()).toEqual([expect.stringContaining('@news')])
    act(() => emit.stackCommand('cycle-next'))
    expect(highlighted()).toEqual([expect.stringContaining('@page-1')])
    act(() => emit.stackCommand('cycle-previous'))
    expect(highlighted()).toEqual([expect.stringContaining('@news')])
    act(() => emit.stackCommand('cycle-end'))
    expect(api.stacks.switch).toHaveBeenLastCalledWith('s3')

    // Ctrl+Shift+Tab starts at the oldest; Escape cancels.
    act(() => emit.stackCommand('cycle-previous'))
    expect(highlighted()).toEqual([expect.stringContaining('@news')])
    act(() => emit.stackCommand('cycle-cancel'))
    act(() => emit.stackCommand('cycle-end'))
    expect(api.stacks.switch).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog', { name: 'Stacks' })).toBeNull()

    // Not while the assistant runs.
    act(() => emit.state({ ...idleState, status: 'running' }))
    act(() => emit.stackCommand('cycle-next'))
    act(() => emit.stackCommand('cycle-end'))
    expect(api.stacks.switch).toHaveBeenCalledTimes(2)
  })

  it('opens the stack list with its search focused; finds stacks and pages of any stack', async () => {
    const three: StacksState = {
      ...state([row(1, 0)], 1),
      stacks: [
        { id: 's1', name: 'page-1', rootTitle: 'Page 1', pages: 1, audio: null },
        { id: 's2', name: 'docs', rootTitle: 'Docs', pages: 2, audio: null },
        { id: 's3', name: 'news', rootTitle: 'Tempest news', pages: 1, audio: null },
      ],
    }
    const page = (id: number, title: string, ref: string) => ({
      id,
      url: `https://site.example/${ref}`,
      title,
      depth: 0,
      last: true,
      ref,
    })
    const fake = fakeApi({
      stacks: three,
      stackPages: [
        {
          id: 's1',
          name: 'page-1',
          rootTitle: 'Page 1',
          rows: [page(1, 'Page 1', 'p1')],
          activeId: 1,
        },
        {
          id: 's2',
          name: 'docs',
          rootTitle: 'Docs',
          rows: [page(1, 'Docs', 'docs'), page(2, 'Tempest manual', 'manual')],
          activeId: 1,
        },
        {
          id: 's3',
          name: 'news',
          rootTitle: 'Tempest news',
          rows: [page(1, 'Tempest news', 'tn')],
          activeId: 1,
        },
      ],
    })
    render(<StackHeader />)
    await act(async () => {})
    const switcher = screen.getByRole('button', { name: /@page-1/ })
    fireEvent.click(switcher)
    await act(async () => {})
    const box = screen.getByRole('combobox', { name: 'Search stacks and pages' })
    expect(document.activeElement).toBe(box)
    expect(fake.api.stacks.pages).toHaveBeenCalled()

    fireEvent.change(box, { target: { value: 'tempest' } })
    const list = screen.getByRole('dialog', { name: 'Stacks' })
    const options = () =>
      within(list)
        .getAllByRole('listitem')
        .map((item) => `${item.getAttribute('aria-selected')}:${item.textContent}`)
    expect(options()).toEqual([
      'true:@newsTempest news · 1 page×',
      'false:Tempest manual@docs · https://site.example/manual',
      'false:Tempest news@news · https://site.example/tn',
    ])
    expect(within(list).getAllByText(/tempest/i, { selector: 'mark' }).length).toBeGreaterThan(0)

    // Arrows move the selection; Enter on a page opens it in its stack.
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).toBe(
      within(list).getAllByRole('listitem')[1]!.id,
    )
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fake.api.stacks.openPage).toHaveBeenCalledWith('s2', 2)
    expect(screen.queryByRole('dialog', { name: 'Stacks' })).toBeNull()

    // Enter on a stack switches; reopening clears the query.
    fireEvent.click(switcher)
    await act(async () => {})
    const again = screen.getByRole('combobox', { name: 'Search stacks and pages' })
    expect((again as HTMLInputElement).value).toBe('')
    fireEvent.change(again, { target: { value: 'doc' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(fake.api.stacks.switch).toHaveBeenCalledWith('s2')

    // Escape clears the query first, then closes and returns to the switcher.
    fireEvent.click(switcher)
    await act(async () => {})
    const third = screen.getByRole('combobox', { name: 'Search stacks and pages' })
    fireEvent.change(third, { target: { value: 'zzz' } })
    expect(screen.getByText('No matching stacks or pages')).toBeTruthy()
    fireEvent.keyDown(third, { key: 'Escape' })
    expect((third as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(third, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Stacks' })).toBeNull()
    expect(document.activeElement).toBe(switcher)
  })

  it('shows sound indicators that mute or unmute a stack without switching', async () => {
    const { api } = await renderHeader({
      ...state([row(1, 0)], 1),
      stacks: [
        { id: 's1', name: 'page-1', rootTitle: 'Page 1', pages: 1, audio: 'playing' },
        { id: 's2', name: 'docs', rootTitle: 'Docs', pages: 1, audio: 'muted' },
        { id: 's3', name: 'news', rootTitle: 'News', pages: 1, audio: null },
      ],
    })
    // The current stack's indicator sits next to its name.
    fireEvent.click(screen.getByRole('button', { name: 'Mute @page-1' }))
    expect(api.stacks.setMuted).toHaveBeenLastCalledWith('s1', true)

    fireEvent.click(screen.getByRole('button', { name: /^@page-1/ }))
    const list = screen.getByRole('dialog', { name: 'Stacks' })
    expect(within(list).getByRole('button', { name: 'Mute @page-1' })).toBeTruthy()
    expect(within(list).queryByRole('button', { name: /mute @news/i })).toBeNull()
    const unmute = within(list).getByRole('button', { name: 'Unmute @docs' })
    expect(unmute.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(unmute)
    expect(api.stacks.setMuted).toHaveBeenLastCalledWith('s2', false)
    expect(api.stacks.switch).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Stacks' })).toBeTruthy()
  })

  it('does not cycle with a single stack', async () => {
    const { api, emit } = await renderHeader({
      ...state([row(1, 0)], 1),
      stacks: [{ id: 's1', name: 'page-1', rootTitle: 'Page 1', pages: 1, audio: null }],
    })
    act(() => emit.stackCommand('cycle-next'))
    expect(screen.queryByRole('dialog', { name: 'Stacks' })).toBeNull()
    act(() => emit.stackCommand('cycle-end'))
    expect(api.stacks.switch).not.toHaveBeenCalled()
  })

  it('shows "New tab" without a stack', async () => {
    await renderHeader({ current: null, stacks: [] })
    expect(screen.getByRole('button', { name: /New tab/ })).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
  })

  describe('Ctrl+E and search', () => {
    const named = (id: number, depth: number, title: string, last = true): StackRow => ({
      ...row(id, depth, last),
      title,
    })
    const focused = () => document.activeElement?.getAttribute('data-row-id')
    const type = (key: string) => fireEvent.keyDown(document.activeElement!, { key })
    const box = () => screen.getByRole('combobox', { name: 'Search pages in this stack' })
    const results = () =>
      within(screen.getByRole('listbox', { name: 'Matching pages' }))
        .getAllByRole('option')
        .map((option) => option.textContent)
    const selected = () =>
      screen.getAllByRole('option').find((option) => option.ariaSelected === 'true')?.textContent
    const rowsOf = [
      named(1, 0, 'Home'),
      named(2, 1, 'Hotel deals', false),
      named(3, 1, 'News', false),
      named(4, 1, 'Hockey'),
    ]

    it('focuses the active row on Ctrl+E and returns to the page from the panel', async () => {
      const { api, emit } = await renderHeader(state(rowsOf, 3))
      act(() => emit.stackCommand('focus-tree'))
      expect(focused()).toBe('3')
      act(() => emit.stackCommand('focus-tree'))
      expect(api.prompt.focusPage).toHaveBeenCalledOnce()
    })

    it('finds pages by any words of the title or URL, with the matches marked', async () => {
      await renderHeader(state(rowsOf, 3))
      fireEvent.change(box(), { target: { value: 'ho' } })
      expect(screen.queryByRole('tree')).toBeNull()
      expect(results()).toEqual([
        'Homehttps://site.example/1',
        'Hotel dealshttps://site.example/2',
        'Hockeyhttps://site.example/4',
      ])
      expect(screen.getByRole('status').textContent).toBe('3 matching pages')
      fireEvent.change(box(), { target: { value: 'deals example/2' } })
      expect(results()).toEqual(['Hotel dealshttps://site.example/2'])
      expect(
        Array.from(screen.getByRole('option').querySelectorAll('mark')).map((m) => m.textContent),
      ).toEqual(['deals', 'example/2'])
      fireEvent.change(box(), { target: { value: 'zebra' } })
      expect(screen.getByText('No matching pages')).toBeTruthy()
    })

    it('moves the selection with the arrows and opens it with Enter or a click', async () => {
      const { api } = await renderHeader(state(rowsOf, 3))
      fireEvent.change(box(), { target: { value: 'ho' } })
      expect(selected()).toContain('Home')
      fireEvent.keyDown(box(), { key: 'ArrowUp' })
      expect(selected()).toContain('Hockey')
      fireEvent.keyDown(box(), { key: 'ArrowDown' })
      fireEvent.keyDown(box(), { key: 'ArrowDown' })
      expect(selected()).toContain('Hotel')
      expect(box().getAttribute('aria-activedescendant')).toMatch(/-2$/)
      fireEvent.keyDown(box(), { key: 'Enter' })
      expect(api.stacks.goToNode).toHaveBeenCalledWith(2)
      expect((box() as HTMLInputElement).value).toBe('')
      expect(focused()).toBe('3')
      fireEvent.change(box(), { target: { value: 'hock' } })
      fireEvent.click(screen.getByRole('option'))
      expect(api.stacks.goToNode).toHaveBeenLastCalledWith(4)
    })

    it('clears with Escape and returns to the active row', async () => {
      await renderHeader(state(rowsOf, 3))
      box().focus()
      fireEvent.change(box(), { target: { value: 'ho' } })
      fireEvent.keyDown(box(), { key: 'Escape' })
      expect((box() as HTMLInputElement).value).toBe('')
      expect(focused()).toBe('3')
      box().focus()
      fireEvent.keyDown(box(), { key: 'Escape' })
      expect(focused()).toBe('3')
    })

    it('moves typing in the tree into the search box; Space and Escape still work', async () => {
      const { api } = await renderHeader(state(rowsOf, 3))
      screen.getByText('Home').closest('li')!.focus()
      type(' ')
      expect(api.stacks.goToNode).toHaveBeenCalledWith(1)
      type('Escape')
      expect(api.prompt.focusPage).toHaveBeenCalledOnce()
      type('h')
      expect(document.activeElement).toBe(box())
      expect((box() as HTMLInputElement).value).toBe('h')
      expect(results()).toHaveLength(3)
    })

    it('searches the whole stack, also pages the collapsed tree hides', async () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        named(i + 1, i === 0 ? 0 : 1, `Page ${i + 1}`),
      )
      many[2] = named(3, 1, 'Zebra')
      await renderHeader(state(many, 1))
      expect(screen.queryByText('Zebra')).toBeNull()
      screen.getByText('Page 1').closest('li')!.focus()
      type('z')
      expect(results()).toEqual(['Zebrahttps://site.example/3'])
    })
  })
})
