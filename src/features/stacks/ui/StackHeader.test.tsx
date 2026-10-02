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
    { id: 's1', name: 'page-1', rootTitle: 'Page 1', pages: rows.length },
    { id: 's2', name: 'docs', rootTitle: 'Docs', pages: 1 },
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

  it('shows "New tab" without a stack', async () => {
    await renderHeader({ current: null, stacks: [] })
    expect(screen.getByRole('button', { name: /New tab/ })).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
  })
})
