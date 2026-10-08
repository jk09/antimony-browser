// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import type { MapNode, MapResult } from '../ipc'
import { MapView } from './MapView'

const node = (id: number, group: number | null, overrides: Partial<MapNode> = {}): MapNode => ({
  id,
  url: `https://site${id}.com/`,
  title: `Page ${id}`,
  domain: `site${id}.com`,
  visitCount: id,
  lastVisitAt: Date.UTC(2026, 9, 1),
  keywords: [],
  group,
  ...overrides,
})

const result: MapResult = {
  nodes: [node(1, 1), node(2, 1), node(3, 1), node(4, null, { title: '' })],
  edges: [
    { from: 1, to: 2, kind: 'link', weight: 2 },
    { from: 2, to: 3, kind: 'keyword', weight: 2 },
  ],
  groups: [{ id: 1, label: 'lions', pageIds: [1, 2, 3] }],
  total: 4,
}

afterEach(cleanup)

async function open(overrides: Partial<MapResult> = {}) {
  const fake = fakeApi()
  fake.api.history.map.mockResolvedValue({ ...result, ...overrides })
  render(<MapView />)
  await act(async () => {})
  expect(screen.queryByRole('region', { name: 'History map' })).toBeNull()
  act(() => fake.emit.mapOpen())
  await screen.findByRole('region', { name: 'History map' })
  await waitFor(() => expect(fake.api.history.map).toHaveBeenCalled())
  return fake
}

describe('MapView', () => {
  it('opens on /history-map, loads the last 7 days and draws groups, pages and both edge kinds', async () => {
    const { api } = await open()
    expect(api.history.map).toHaveBeenCalledWith({ range: '7d', text: '' })
    const region = screen.getByRole('region', { name: 'History map' })
    expect(region.querySelectorAll('.map-group')).toHaveLength(2)
    expect(region.querySelectorAll('.map-node')).toHaveLength(4)
    expect(region.querySelectorAll('.map-edge-link')).toHaveLength(1)
    expect(region.querySelectorAll('.map-edge-keyword')).toHaveLength(1)
    expect(region.textContent).toContain('followed a link')
    expect(region.textContent).toContain('share keywords')
    const outline = within(screen.getByRole('navigation', { name: 'Pages by group' }))
    expect(outline.getByRole('heading', { name: 'lions' })).toBeTruthy()
    expect(outline.getByRole('heading', { name: 'Other' })).toBeTruthy()
    expect(outline.getByRole('button', { name: 'site4.com/' })).toBeTruthy()
  })

  it('reloads for another range and a filter, and says when nothing matches', async () => {
    const { api } = await open()
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    await waitFor(() =>
      expect(api.history.map).toHaveBeenLastCalledWith({ range: '30d', text: '' }),
    )
    api.history.map.mockResolvedValue({ nodes: [], edges: [], groups: [], total: 0 })
    fireEvent.change(screen.getByLabelText('Filter pages'), { target: { value: 'zzz' } })
    await waitFor(() =>
      expect(api.history.map).toHaveBeenLastCalledWith({ range: '30d', text: 'zzz' }),
    )
    expect(await screen.findByText('Nothing matches.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter pages'), { target: { value: '' } })
    expect(await screen.findByText('No pages in this range.')).toBeTruthy()
  })

  it('notes when more pages matched than are shown', async () => {
    await open({ total: 812 })
    expect(screen.getByText('Showing the 4 most recent of 812 pages.')).toBeTruthy()
  })

  it('opens a page from the map and closes', async () => {
    const { api } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    expect(api.navigation.go).toHaveBeenCalledWith('https://site2.com/')
    expect(screen.queryByRole('region', { name: 'History map' })).toBeNull()
  })

  it('focuses the filter on opening, so Escape closes the map from the prompt', async () => {
    await open()
    expect(document.activeElement).toBe(screen.getByLabelText('Filter pages'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'History map' })).toBeNull()
  })

  it('closes with × and Escape', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Close history map' }))
    expect(screen.queryByRole('region', { name: 'History map' })).toBeNull()
    const { api } = await open()
    expect(api.history.map).toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('region', { name: 'History map' }), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'History map' })).toBeNull()
  })

  it('refreshes when history changes while open', async () => {
    const { api, emit } = await open()
    api.history.map.mockClear()
    await act(async () => emit.historyChanged())
    await waitFor(() => expect(api.history.map).toHaveBeenCalledTimes(1))
  })

  it('zooms with the buttons', async () => {
    await open()
    const layer = () => document.querySelector('.map-canvas > g:last-of-type')!
    expect(layer().getAttribute('transform')).toContain('scale(1)')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(layer().getAttribute('transform')).toContain('scale(1.25)')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(layer().getAttribute('transform')).toContain('scale(0.8)')
  })
})
