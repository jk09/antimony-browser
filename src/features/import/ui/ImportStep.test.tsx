// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import { ImportStep } from './ImportStep'

const result = {
  rows: 14,
  visitsImported: 12,
  pagesCreated: 9,
  pagesUpdated: 1,
  duplicates: 0,
  skipped: { invalid: 1, unsupported: 1 },
  stacksCreated: 2,
  stacksSkipped: 0,
  grouping: 'topics' as const,
}

describe('ImportStep', () => {
  afterEach(cleanup)

  it('imports the chosen file and shows what was imported', async () => {
    const { api } = fakeApi()
    api.import.choose.mockResolvedValue('/home/me/edge.csv')
    api.import.run.mockResolvedValue(result)
    render(<ImportStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))
    const status = screen.getByRole('status')
    await waitFor(() => expect(status.textContent).toContain('Imported 12 visits'))
    expect(status.textContent).toContain(
      '(9 new pages) into history and 2 stacks, grouped by topic; skipped 2 rows',
    )
    expect(status.textContent).toContain('/home/me/edge.csv')
    expect(api.import.run).toHaveBeenCalledWith('/home/me/edge.csv')
    expect(screen.getByRole('button', { name: 'Choose another file…' })).toBeTruthy()
  })

  it('does nothing when the dialog is cancelled', async () => {
    const { api } = fakeApi()
    render(<ImportStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))
    await waitFor(() => expect(api.import.choose).toHaveBeenCalled())
    expect(api.import.run).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('shows the error of a file that cannot be imported, without the IPC prefix', async () => {
    const { api } = fakeApi()
    api.import.choose.mockResolvedValue('/home/me/passwords.csv')
    api.import.run.mockRejectedValue(
      new Error(
        "Error invoking remote method 'import:run': ImportFileError: This doesn't look like Edge's browsing-data export.",
      ),
    )
    render(<ImportStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        "This doesn't look like Edge's browsing-data export.",
      ),
    )
  })

  it('disables the button while importing', async () => {
    const { api } = fakeApi()
    let finish: (value: typeof result) => void = () => {}
    api.import.choose.mockResolvedValue('/e.csv')
    api.import.run.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<ImportStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Importing /e.csv'),
    )
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    finish(result)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Imported 12'))
  })
})
