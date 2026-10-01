import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { getPage } from '../navigation/main'
import { channels, HISTORY_LIMIT, type HistoryEntry, type HistoryKind } from './ipc'
import { addEntry, historyText } from './shared/history'

const kinds: HistoryKind[] = ['url', 'query', 'command']
const MAX_TEXT = 2000

function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) throw new TypeError('history must be an array')
  return raw
    .filter(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        kinds.includes(entry.kind) &&
        typeof entry.text === 'string' &&
        typeof entry.at === 'number',
    )
    .slice(0, HISTORY_LIMIT)
}

export function register({ window, ipc, fileMenu }: MainContext): void {
  const store = createJsonStore(join(app.getPath('userData'), 'prompt-history.json'), {
    parse: parseHistory,
    fallback: (): HistoryEntry[] => [],
  })
  app.on('will-quit', () => store.flush())

  ipc.handle(channels.history, () => store.get())
  ipc.handle(channels.record, (value) => {
    const entry = value as { kind?: unknown; text?: unknown } | null
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !kinds.includes(entry.kind as HistoryKind) ||
      typeof entry.text !== 'string' ||
      entry.text.length > MAX_TEXT
    ) {
      throw new TypeError(`${channels.record} expects { kind, text }`)
    }
    const kind = entry.kind as HistoryKind
    const text = kind === 'command' ? historyText(entry.text) : entry.text
    store.set(addEntry(store.get(), { kind, text }, Date.now()))
  })
  ipc.handle(channels.clearHistory, () => store.set([]))
  ipc.handle(channels.focusPage, () => getPage()?.contents()?.focus())

  fileMenu.push({
    id: 'prompt',
    label: 'Prompt…',
    accelerator: 'CmdOrCtrl+L',
    click: () => {
      // The page view may have focus; the prompt lives in the chrome UI.
      window.webContents.focus()
      ipc.send(channels.open, null)
    },
  })
  fileMenu.push({
    id: 'prompt-toggle',
    label: 'Toggle Assistant',
    accelerator: 'CmdOrCtrl+B',
    click: () => {
      // Showing focuses the prompt; hiding hands focus back to the page (`focusPage`).
      window.webContents.focus()
      ipc.send(channels.toggle, null)
    },
  })
}
