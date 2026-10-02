// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import type { RecalledPage, RecallResult } from '../ipc'
import { cloudItems, RecallView } from './RecallView'
import { sketchToJpeg, type Stroke } from './SketchPad'

const page = (id: number, overrides: Partial<RecalledPage> = {}): RecalledPage => ({
  id,
  url: `https://example.com/${id}`,
  title: `Page ${id}`,
  description: null,
  lastVisitAt: Date.UTC(2026, 8, 30),
  visitCount: 1,
  dwellMs: 40_000,
  note: null,
  summary: null,
  hasScreenshot: false,
  score: 0.5,
  keywords: [],
  ...overrides,
})

const result: RecallResult = {
  view: 'words',
  pages: [
    page(1, { title: 'Lions of the Serengeti', score: 0.9, hasScreenshot: true }),
    page(2, { title: 'Zoo opening hours', score: 0.4 }),
  ],
  keywords: [
    { text: 'lions', weight: 1.3, pageIds: [1, 2] },
    { text: 'savanna', weight: 0.9, pageIds: [1] },
    { text: 'zoo', weight: 0.4, pageIds: [2] },
  ],
}

// jsdom has no canvas: a fake 2D context and JPEG export.
const context = {
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    (type?: string) => `data:${type};base64,/9j/SKETCH`,
  )
  for (const fn of [
    context.fillRect,
    context.beginPath,
    context.moveTo,
    context.lineTo,
    context.stroke,
  ]) {
    fn.mockClear()
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openRecall(query = 'lions') {
  const fake = fakeApi()
  fake.api.history.recall.mockResolvedValue(result)
  fake.api.history.screenshot.mockResolvedValue('data:image/jpeg;base64,AAAA' as never)
  render(<RecallView />)
  await act(async () => {})
  act(() => fake.emit.recallOpen(query))
  return fake
}

describe('RecallView', () => {
  it('stays closed until opened', () => {
    fakeApi()
    render(<RecallView />)
    expect(screen.queryByRole('region', { name: 'Recall' })).toBeNull()
  })

  it('recalls the request from /recall and shows a keyword cloud', async () => {
    const { api } = await openRecall('show all pages about lions')
    expect(api.history.recall).toHaveBeenCalledWith({
      query: 'show all pages about lions',
      sketch: null,
    })
    const cloud = await screen.findByRole('list', { name: 'Keyword cloud' })
    const words = within(cloud).getAllByRole('button')
    expect(words.map((word) => word.textContent)).toEqual(['lions', 'savanna', 'zoo'])
    expect(within(cloud).getByRole('button', { name: 'lions, 2 pages' })).toBeTruthy()
    const size = (text: string) => parseFloat(within(cloud).getByText(text).style.fontSize || '0')
    expect(size('lions')).toBeGreaterThan(size('savanna'))
    expect(size('savanna')).toBeGreaterThan(size('zoo'))
  })

  it('lists the pages of a keyword and opens one, closing Recall', async () => {
    const { api } = await openRecall()
    fireEvent.click(await screen.findByRole('button', { name: 'savanna, 1 page' }))
    const list = screen.getByRole('complementary', { name: 'Pages about savanna' })
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Lions of the Serengetiexample.com/1'])
    fireEvent.click(within(list).getByRole('button'))
    expect(api.navigation.go).toHaveBeenCalledWith('https://example.com/1')
    expect(api.history.cancelRecall).toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Recall' })).toBeNull()
  })

  it('switches to pictures: screenshots or titles, sized by score', async () => {
    const { api } = await openRecall()
    await screen.findByRole('list', { name: 'Keyword cloud' })
    fireEvent.click(screen.getByRole('radio', { name: 'Pictures' }))
    const cloud = screen.getByRole('list', { name: 'Picture cloud' })
    await waitFor(() => expect(cloud.querySelector('img')).not.toBeNull())
    expect(api.history.screenshot).toHaveBeenCalledWith(1)
    expect(api.history.screenshot).toHaveBeenCalledTimes(1)
    const lions = within(cloud).getByRole('button', { name: 'Lions of the Serengeti' })
    const zoo = within(cloud).getByRole('button', { name: 'Zoo opening hours' })
    expect(zoo.textContent).toBe('Zoo opening hours')
    const width = (button: HTMLElement) => parseFloat(button.parentElement!.style.width)
    expect(width(lions)).toBeGreaterThan(width(zoo))
    fireEvent.click(zoo)
    expect(api.navigation.go).toHaveBeenCalledWith('https://example.com/2')
  })

  it('sends a sketch, says screenshots go to the model, and follows the suggested view', async () => {
    const { api } = await openRecall('')
    expect(api.history.recall).not.toHaveBeenCalled()
    const recall = screen.getByRole('button', { name: 'Recall' }) as HTMLButtonElement
    expect(recall.disabled).toBe(true)

    api.history.recall.mockResolvedValue({ ...result, view: 'images' })
    const pad = screen.getByRole('img', { name: /Sketch pad/ })
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(pad, { clientX: 20, clientY: 20 })
    fireEvent.pointerUp(pad)
    expect(screen.getByText(/your sketch and up to 16 small screenshots/)).toBeTruthy()
    fireEvent.click(recall)
    await waitFor(() =>
      expect(api.history.recall).toHaveBeenCalledWith({
        query: '',
        sketch: 'data:image/jpeg;base64,/9j/SKETCH',
      }),
    )
    expect(await screen.findByRole('list', { name: 'Picture cloud' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear sketch' }))
    expect(screen.queryByText(/your sketch/)).toBeNull()
    expect(recall.disabled).toBe(true)
  })

  it('shows notices, "nothing matches" and errors; Escape closes', async () => {
    const { api } = await openRecall()
    api.history.recall.mockResolvedValue({
      view: 'words',
      pages: [],
      keywords: [],
      notice: 'Recall by meaning failed (no key); showing text matches.',
    })
    fireEvent.submit(screen.getByRole('search'))
    expect(await screen.findByText(/showing text matches/)).toBeTruthy()
    expect(screen.getByText('Nothing in history matches.')).toBeTruthy()

    api.history.recall.mockRejectedValue(new Error('recall needs a query or a sketch'))
    fireEvent.submit(screen.getByRole('search'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs a query/)

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'What to recall' }), {
      key: 'Escape',
    })
    expect(screen.queryByRole('region', { name: 'Recall' })).toBeNull()
    expect(api.history.cancelRecall).toHaveBeenCalled()
  })

  it('ignores an answer that arrives after a newer request', async () => {
    const fake = fakeApi()
    let resolveFirst: (value: RecallResult) => void = () => {}
    fake.api.history.recall
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ ...result, keywords: [{ text: 'newer', weight: 1, pageIds: [1] }] })
    render(<RecallView />)
    await act(async () => {})
    act(() => fake.emit.recallOpen('first'))
    act(() => fake.emit.recallOpen('second'))
    expect(await screen.findByRole('button', { name: 'newer, 1 page' })).toBeTruthy()
    await act(async () => resolveFirst(result))
    expect(screen.queryByRole('button', { name: /^savanna/ })).toBeNull()
  })
})

describe('cloud items', () => {
  it('size words by weight and tiles by score', () => {
    const words = cloudItems(result, 'words')
    expect(words.map((item) => item.id)).toEqual(['lions', 'savanna', 'zoo'])
    expect(words[0]!.height).toBeGreaterThan(words[2]!.height)
    const tiles = cloudItems(result, 'images')
    expect(tiles.map((item) => item.id)).toEqual(['1', '2'])
    expect(tiles[0]!.width).toBeGreaterThan(tiles[1]!.width)
  })
})

describe('sketchToJpeg', () => {
  it('paints the strokes on white and exports a JPEG data URL', () => {
    const strokes: Stroke[] = [
      [
        [0, 0],
        [1, 1],
      ],
      [[0.5, 0.5]],
    ]
    expect(sketchToJpeg(strokes)).toBe('data:image/jpeg;base64,/9j/SKETCH')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 480, 320)
    expect(context.moveTo).toHaveBeenCalledWith(0, 0)
    expect(context.lineTo).toHaveBeenCalledWith(480, 320)
    // A dot for a single point.
    expect(context.lineTo).toHaveBeenCalledWith(240, 160)
    expect(sketchToJpeg([])).toBeNull()
  })
})
