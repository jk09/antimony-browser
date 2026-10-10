import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { complete } from '../agent/main'
import { channels, type OpenRequest } from './ipc'
import { generateThemes, parseDescription } from './main/generate'
import { checkTheme, parseTheme, type Theme } from './shared/theme'

const CAPTURE_WIDTH = 800
const MODEL_TIMEOUT_MS = 120_000

interface Stored {
  theme: Theme | null
}

/** A stored theme, or null when there is none or it no longer passes the checks. */
export function parseStored(raw: unknown): Stored {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('expected an object')
  const theme = (raw as Record<string, unknown>)['theme']
  if (theme === null || theme === undefined) return { theme: null }
  return { theme: checkTheme(parseTheme(theme))?.theme ?? null }
}

/** Throws unless `value` is null or a theme that meets the contrast rules (repaired if needed). */
export function parseThemeUpdate(value: unknown): Theme | null {
  if (value === null) return null
  const checked = checkTheme(parseTheme(value))
  if (!checked) throw new TypeError('this theme is not readable enough')
  return checked.theme
}

function parseOpenRequest(value: unknown): OpenRequest {
  if (value === undefined || value === null) return { description: '' }
  if (typeof value !== 'object') throw new TypeError('expected { description }')
  const description = (value as Record<string, unknown>)['description']
  if (description === undefined || description === '') return { description: '' }
  return { description: parseDescription(description) }
}

export function register({ ipc, window, fileMenu }: MainContext): void {
  const store = createJsonStore<Stored>(join(app.getPath('userData'), 'appearance.json'), {
    parse: parseStored,
    fallback: () => ({ theme: null }),
  })
  app.on('will-quit', () => store.flush())
  const open = (request: OpenRequest) => ipc.send(channels.open, request)
  // The running model request; a new one or Cancel stops it.
  let generating: AbortController | null = null

  ipc.handle(channels.get, () => store.get().theme)
  ipc.handle(channels.set, (value) => {
    const theme = parseThemeUpdate(value)
    store.set({ theme })
    ipc.send(channels.changed, theme)
    return theme
  })
  ipc.handle(channels.generate, async (value) => {
    const description = parseDescription(value)
    generating?.abort()
    const controller = new AbortController()
    generating = controller
    try {
      return await generateThemes(
        complete,
        description,
        AbortSignal.any([controller.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
      )
    } finally {
      if (generating === controller) generating = null
    }
  })
  ipc.handle(channels.cancel, () => {
    generating?.abort()
    generating = null
  })
  // The chrome UI's own pixels: page views are hidden while the appearance picker shows.
  ipc.handle(channels.capture, async () => {
    const image = await window.webContents.capturePage()
    if (image.isEmpty()) return null
    const { width } = image.getSize()
    const scaled = width > CAPTURE_WIDTH ? image.resize({ width: CAPTURE_WIDTH }) : image
    return `data:image/jpeg;base64,${scaled.toJPEG(80).toString('base64')}`
  })
  ipc.handle(channels.requestOpen, (value) => open(parseOpenRequest(value)))

  fileMenu.push({ id: 'appearance', label: 'Appearance…', click: () => open({ description: '' }) })
}
