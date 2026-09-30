import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session } from 'electron'
import { features } from './features'
import { createChromeUiIpc } from './ipc'
import { denyAllPermissions, hardenApp, hardenChromeUi, secureWebPreferences } from './security'

const BROWSING_PARTITION = 'persist:browsing'

function chromeUiUrl(): string {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServer) return devServer
  return pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    title: 'Antimony',
    show: false,
    webPreferences: {
      ...secureWebPreferences,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
  })
  window.once('ready-to-show', () => window.show())

  const url = chromeUiUrl()
  hardenChromeUi(window.webContents, url)

  const browsingSession = session.fromPartition(BROWSING_PARTITION)
  denyAllPermissions(browsingSession)

  // Register features before the chrome UI loads, so their IPC handlers exist when it calls them.
  const ipc = createChromeUiIpc(window.webContents)
  for (const register of features) await register({ window, browsingSession, ipc })

  await window.loadURL(url)
}

hardenApp()

// Single window for now; supporting several windows needs a spec (features register IPC once).
app.on('window-all-closed', () => app.quit())

app
  .whenReady()
  .then(createWindow)
  .catch((error: unknown) => {
    console.error('Failed to start Antimony', error)
    app.exit(1)
  })
