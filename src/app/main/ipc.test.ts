import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) },
}))

const { createChromeUiIpc } = await import('./ipc')

const chromeUi = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
const event = (sender: unknown, frame: unknown) =>
  ({ sender, senderFrame: frame }) as unknown as IpcMainInvokeEvent

describe('createChromeUiIpc', () => {
  beforeEach(() => handlers.clear())

  it('passes calls from the chrome UI main frame to the handler', () => {
    createChromeUiIpc(chromeUi).handle('demo:echo', (value) => value)
    expect(handlers.get('demo:echo')!(event(chromeUi, { parent: null }), 'hi')).toBe('hi')
  })

  it('rejects calls from web pages and subframes', () => {
    createChromeUiIpc(chromeUi).handle('demo:echo', (value) => value)
    const handler = handlers.get('demo:echo')!
    expect(() => handler(event({}, { parent: null }), 'hi')).toThrow('Rejected demo:echo')
    expect(() => handler(event(chromeUi, { parent: {} }), 'hi')).toThrow('Rejected demo:echo')
    expect(() => handler(event(chromeUi, null), 'hi')).toThrow('Rejected demo:echo')
  })
})
