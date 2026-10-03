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

const SNAPSHOT_WIDTH = 1280

const hasCommand = (input: Electron.Input, platform: string) =>
  platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta

/** Ctrl/Cmd+B pressed or held (key repeat): the assistant panel's shortcut. */
export function isToggleKey(input: Electron.Input, platform: string = process.platform): boolean {
  return (
    input.type === 'keyDown' &&
    hasCommand(input, platform) &&
    !input.alt &&
    !input.shift &&
    input.key.toLowerCase() === 'b'
  )
}

/** Ctrl/Cmd+I: the field-of-view prompt's shortcut. */
export function isFieldOfViewKey(
  input: Electron.Input,
  platform: string = process.platform,
): boolean {
  return (
    input.type === 'keyDown' &&
    hasCommand(input, platform) &&
    !input.alt &&
    !input.shift &&
    input.key.toLowerCase() === 'i'
  )
}

/** Ctrl/Cmd+Alt+I: the sidebar prompt's shortcut (matched by key code: Option+I types ˆ on macOS). */
export function isSidebarPromptKey(
  input: Electron.Input,
  platform: string = process.platform,
): boolean {
  return (
    input.type === 'keyDown' &&
    hasCommand(input, platform) &&
    input.alt &&
    !input.shift &&
    (input.code === 'KeyI' || input.key.toLowerCase() === 'i')
  )
}

export function register({ window, browsingSession, ipc, fileMenu }: MainContext): void {
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
  // The page view sits above the chrome UI, so the field of view can only draw over the page
  // while the view is hidden; the chrome UI shows this snapshot in its place.
  ipc.handle(channels.coverPage, async () => {
    const page = getPage()
    const contents = page?.contents()
    let snapshot: string | null = null
    if (contents) {
      try {
        const image = await contents.capturePage()
        const { width } = image.getSize()
        const scaled = width > SNAPSHOT_WIDTH ? image.resize({ width: SNAPSHOT_WIDTH }) : image
        if (width > 0) snapshot = `data:image/jpeg;base64,${scaled.toJPEG(70).toString('base64')}`
      } catch (error) {
        console.warn('Could not capture the page', error)
      }
    }
    page?.setHidden(true)
    return snapshot
  })
  ipc.handle(channels.uncoverPage, () => getPage()?.setHidden(false))

  const openSidebarPrompt = () => {
    // The page view may have focus; the prompt lives in the chrome UI.
    window.webContents.focus()
    ipc.send(channels.open, null)
  }
  fileMenu.push({
    id: 'prompt',
    label: 'Prompt…',
    accelerator: 'CmdOrCtrl+L',
    click: openSidebarPrompt,
  })
  fileMenu.push({
    id: 'prompt-sidebar',
    label: 'Assistant Prompt',
    accelerator: 'CmdOrCtrl+Alt+I',
    click: openSidebarPrompt,
  })
  const openFieldOfView = () => {
    window.webContents.focus()
    ipc.send(channels.fieldOfView, null)
  }
  fileMenu.push({
    id: 'prompt-field-of-view',
    label: 'Field of View Prompt…',
    accelerator: 'CmdOrCtrl+I',
    click: openFieldOfView,
  })
  const toggle = () => {
    // Showing focuses the prompt; hiding hands focus back to the page (`focusPage`).
    window.webContents.focus()
    ipc.send(channels.toggle, null)
  }
  fileMenu.push({
    id: 'prompt-toggle',
    label: 'Toggle Assistant',
    accelerator: 'CmdOrCtrl+B',
    click: toggle,
  })

  // Ctrl/Cmd+B, I and Alt+I are caught before the page or the menu sees them: a page view doesn't
  // always pass them on to the menu accelerator (Windows), and a page may handle them itself.
  // preventDefault keeps the menu accelerator from acting a second time. A held key acts once:
  // its repeats are swallowed too, or each would reach the menu accelerator and act again.
  const catchShortcuts = (contents: Electron.WebContents) =>
    contents.on('before-input-event', (event, input) => {
      const action = isToggleKey(input)
        ? toggle
        : isFieldOfViewKey(input)
          ? openFieldOfView
          : isSidebarPromptKey(input)
            ? openSidebarPrompt
            : null
      if (!action) return
      event.preventDefault()
      if (!input.isAutoRepeat) action()
    })
  catchShortcuts(window.webContents)
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session === browsingSession) catchShortcuts(contents)
  })
}
