// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import { AssistantPanel } from '../../prompt/ui/AssistantPanel'
import { SNIPPET_END, SNIPPET_START, type HistoryPage } from '../ipc'
import { formatDwell, HistoryView } from './HistoryView'

afterEach(cleanup)

const page = (overrides: Partial<HistoryPage> = {}): HistoryPage => ({
  id: 1,
  url: 'https://www.sqlite.org/wal.html',
  title: 'Write-Ahead Logging',
  description: 'How WAL works',
  lastVisitAt: Date.UTC(2026, 8, 30, 10),
  visitCount: 3,
  dwellMs: 125_000,
  note: null,
  summary: null,
  hasScreenshot: true,
  ...overrides,
})

async function openView(request: { query?: string; note?: boolean } = {}) {
  const fake = fakeApi()
  fake.api.history.search.mockResolvedValue({
    pages: [
      page({ snippet: `readers do not ${SNIPPET_START}block${SNIPPET_END} writers` }),
      page({
        id: 2,
        url: 'https://example.com/cats',
        title: 'Cats',
        note: 'Ask Ana',
        hasScreenshot: false,
      }),
    ],
  } as never)
  fake.api.history.screenshot.mockResolvedValue('data:image/jpeg;base64,AAAA' as never)
  render(<HistoryView />)
  await act(async () => {})
  act(() => fake.emit.historyOpen(request))
  return fake
}

describe('HistoryView', () => {
  it('stays closed until opened', () => {
    fakeApi()
    render(<HistoryView />)
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull()
  })

  it('searches as you type and lists pages with snippet, note, visits and thumbnail', async () => {
    const { api } = await openView({ query: 'block' })
    await waitFor(() =>
      expect(api.history.search).toHaveBeenLastCalledWith({
        query: 'block',
        mode: 'text',
        bookmarked: false,
      }),
    )
    const results = await screen.findByRole('list', { name: 'History results' })
    const rows = within(results).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('mark')!.textContent).toBe('block')
    expect(rows[0]!.textContent).toContain('sqlite.org/wal.html')
    expect(rows[0]!.textContent).toContain('3 visits')
    expect(rows[0]!.textContent).toContain('2 min')
    expect(rows[1]!.textContent).toContain('📌 Ask Ana')
    await waitFor(() => expect(rows[0]!.querySelector('img')).not.toBeNull())
    expect(api.history.screenshot).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), {
      target: { value: 'cats' },
    })
    await waitFor(() =>
      expect(api.history.search).toHaveBeenLastCalledWith({
        query: 'cats',
        mode: 'text',
        bookmarked: false,
      }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bookmarks' }))
    await waitFor(() =>
      expect(api.history.search).toHaveBeenLastCalledWith({
        query: 'cats',
        mode: 'text',
        bookmarked: true,
      }),
    )
    expect(screen.getByRole('heading').textContent).toBe('Bookmarks')
  })

  it('opens a page, edits its note and deletes it', async () => {
    const { api } = await openView()
    fireEvent.click(await screen.findByRole('button', { name: 'Cats' }))
    expect(api.navigation.go).toHaveBeenCalledWith('https://example.com/cats')

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    const editor = screen.getByRole('textbox', { name: 'Note for Write-Ahead Logging' })
    fireEvent.change(editor, { target: { value: 'Compare with Postgres' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() =>
      expect(api.history.setNote).toHaveBeenCalledWith(1, 'Compare with Postgres'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }))
    await waitFor(() => expect(api.history.setNote).toHaveBeenLastCalledWith(2, null))

    const searches = api.history.search.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Delete Cats from history' }))
    await waitFor(() => expect(api.history.delete).toHaveBeenCalledWith(2))
    await waitFor(() => expect(api.history.search.mock.calls.length).toBeGreaterThan(searches))
  })

  it('searches by meaning only on request and shows why results fell back', async () => {
    const { api } = await openView({ query: 'blue pricing table' })
    await waitFor(() => expect(api.history.search).toHaveBeenCalled())
    api.history.search.mockResolvedValue({
      pages: [page()],
      notice: 'Search by meaning failed (no key); showing text matches.',
    } as never)
    fireEvent.click(screen.getByRole('radio', { name: 'Meaning' }))
    await waitFor(() =>
      expect(api.history.search).toHaveBeenLastCalledWith({
        query: 'blue pricing table',
        mode: 'semantic',
        bookmarked: false,
      }),
    )
    expect(await screen.findByText(/showing text matches/)).toBeTruthy()

    const calls = api.history.search.mock.calls.length
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'blue pricing tables' } })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(api.history.search.mock.calls.length).toBe(calls)
    fireEvent.submit(screen.getByRole('search'))
    await waitFor(() => expect(api.history.search.mock.calls.length).toBe(calls + 1))
  })

  it('edits the note of the current page (Ctrl/Cmd+D) and closes with Escape', async () => {
    const fake = fakeApi()
    fake.api.history.current.mockResolvedValue(page({ note: 'old' }) as never)
    render(<HistoryView />)
    await act(async () => {})
    act(() => fake.emit.historyOpen({ note: true }))
    const editor = await screen.findByRole('textbox', { name: 'Note for this page' })
    expect((editor as HTMLTextAreaElement).value).toBe('old')
    fireEvent.change(editor, { target: { value: 'new note' } })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(fake.api.history.setNote).toHaveBeenCalledWith(1, 'new note'))

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull()
  })

  it('says when the current page is not in history', async () => {
    await openView({ note: true })
    expect(await screen.findByText(/isn’t in history/)).toBeTruthy()
  })

  it('shows the assistant panel when history opens', async () => {
    const fake = fakeApi()
    render(<AssistantPanel overlay={<HistoryView />} />)
    await act(async () => {})
    act(() => fake.emit.toggle())
    expect((screen.getByRole('complementary', { hidden: true }) as HTMLElement).hidden).toBe(true)
    act(() => fake.emit.historyOpen({}))
    expect((screen.getByRole('complementary') as HTMLElement).hidden).toBe(false)
    expect(screen.getByRole('region', { name: 'History' })).toBeTruthy()
  })
})

describe('formatDwell', () => {
  it.each([
    [12_400, '12 s'],
    [125_000, '2 min'],
    [3_600_000, '1 h'],
    [4_800_000, '1 h 20 min'],
  ])('%i ms is %s', (ms, text) => {
    expect(formatDwell(ms)).toBe(text)
  })
})
