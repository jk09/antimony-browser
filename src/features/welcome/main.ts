import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { channels, type WelcomeState } from './ipc'

export function parseState(raw: unknown): WelcomeState {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('expected an object')
  return { done: (raw as Record<string, unknown>)['done'] === true }
}

export function register({ ipc, fileMenu }: MainContext): void {
  const store = createJsonStore(join(app.getPath('userData'), 'welcome.json'), {
    parse: parseState,
    fallback: () => ({ done: false }),
  })
  app.on('will-quit', () => store.flush())
  const open = () => ipc.send(channels.open, null)

  ipc.handle(channels.state, () => store.get())
  ipc.handle(channels.setDone, (done) => {
    if (typeof done !== 'boolean') throw new TypeError('done must be a boolean')
    store.set({ done })
    return store.get()
  })
  ipc.handle(channels.requestOpen, open)

  fileMenu.push({ id: 'welcome', label: 'Welcome', click: open })
}
