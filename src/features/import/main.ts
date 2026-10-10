import { dialog } from 'electron'
import type { MainContext } from '../../app/main/features'
import { complete, provideImporter } from '../agent/main'
import { importVisits } from '../history/main'
import { importStacks } from '../stacks/main'
import { channels, describeResult, MAX_PATH, type ImportResult } from './ipc'
import { ImportFileError, runImport } from './main/run'

/** A path from the chrome UI: a non-empty string of reasonable length. */
export function parsePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_PATH) {
    throw new TypeError('expected the path of a file')
  }
  return value
}

export function register({ window, ipc }: MainContext): void {
  let running = false
  /** One import at a time; errors the user can act on keep their message. */
  const run = async (path: string, signal?: AbortSignal): Promise<ImportResult> => {
    if (running) throw new ImportFileError('An import is already running.')
    running = true
    try {
      return await runImport(path, { importVisits, importStacks, complete }, Date.now(), signal)
    } finally {
      running = false
    }
  }

  /** The native file dialog; null if the user cancelled. */
  const choose = async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Choose the browsing data exported from Edge',
      properties: ['openFile'],
      filters: [{ name: 'CSV file', extensions: ['csv'] }],
    })
    return canceled || filePaths.length === 0 ? null : filePaths[0]!
  }

  // The skill and the assistant's tool get the result as one line; without a path the user
  // chooses the file in the dialog.
  provideImporter({
    run: async (path, signal) => {
      const file = path.trim() === '' ? await choose() : path
      if (file === null) return 'No file was chosen.'
      return describeResult(await run(file, signal))
    },
  })

  ipc.handle(channels.choose, () => choose())
  ipc.handle(channels.run, (path) => run(parsePath(path)))
}
