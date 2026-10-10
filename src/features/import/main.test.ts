import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'
import type { ImportPort } from '../agent/main'

const dialog = { showOpenDialog: vi.fn() }
vi.mock('electron', () => ({ dialog }))
let port: ImportPort | null = null
vi.mock('../agent/main', () => ({
  provideImporter: (value: ImportPort) => {
    port = value
  },
}))
vi.mock('../history/main', () => ({ importVisits: vi.fn() }))
vi.mock('../stacks/main', () => ({ importStacks: vi.fn() }))
const runImport = vi.fn()
vi.mock('./main/run', () => ({
  ImportFileError: class ImportFileError extends Error {},
  runImport: (path: string) => runImport(path),
}))

const { register, parsePath } = await import('./main')
const { channels } = await import('./ipc')

const result = {
  rows: 3,
  visitsImported: 3,
  pagesCreated: 3,
  pagesUpdated: 0,
  duplicates: 0,
  skipped: { invalid: 0, unsupported: 0 },
  stacksCreated: 1,
  stacksSkipped: 0,
}

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const window = {}
  register({
    window,
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
  } as unknown as MainContext)
  return { window, call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) }
}

describe('import main', () => {
  beforeEach(() => {
    runImport.mockReset()
    dialog.showOpenDialog.mockReset()
  })

  it('accepts only a path string from the chrome UI', () => {
    expect(parsePath('/a.csv')).toBe('/a.csv')
    for (const bad of [undefined, 3, '', '  ', 'x'.repeat(5000), { path: '/a.csv' }]) {
      expect(() => parsePath(bad)).toThrow(TypeError)
    }
  })

  it('chooses a .csv file with the native dialog, or null when cancelled', async () => {
    const { call, window } = setup()
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/home/me/e.csv'] })
    expect(await call(channels.choose)).toBe('/home/me/e.csv')
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({ filters: [{ name: 'CSV file', extensions: ['csv'] }] }),
    )
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call(channels.choose)).toBeNull()
  })

  it('runs an import for the UI and gives the skill and assistant one line', async () => {
    const { call } = setup()
    runImport.mockResolvedValue(result)
    expect(await call(channels.run, '/e.csv')).toEqual(result)
    expect(await port!.run('/e.csv')).toBe(
      'Imported 3 visits (3 new pages) into history and 1 stack.',
    )
    expect(() => call(channels.run, 7)).toThrow(TypeError)
  })

  it('runs one import at a time and allows the next after a failure', async () => {
    const { call } = setup()
    let finish: (value: unknown) => void = () => {}
    runImport.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const first = call(channels.run, '/a.csv')
    await expect(call(channels.run, '/b.csv')).rejects.toThrow('already running')
    finish(result)
    await first
    runImport.mockRejectedValueOnce(new Error('bad file'))
    await expect(call(channels.run, '/c.csv')).rejects.toThrow('bad file')
    runImport.mockResolvedValueOnce(result)
    await expect(call(channels.run, '/d.csv')).resolves.toEqual(result)
  })
})
