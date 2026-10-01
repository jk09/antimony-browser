import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, Menu, session, type MenuItemConstructorOptions } from 'electron'
import { windowTitle } from '../../shared/build-info'
import { features } from './features'
import { createChromeUiIpc } from './ipc'
import { appMenuTemplate } from './menu'
import { denyAllPermissions, hardenApp, hardenChromeUi, secureWebPreferences } from './security'
import { nextZoomFactor, type ZoomDirection } from './zoom'

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
    title: windowTitle,
    show: false,
    // No menu bar on Windows and Linux, so the page gets the space; `/menu` in the prompt reaches
    // every item (features/menu). Auto-hide, not setMenuBarVisibility(false): a hidden menu bar
    // drops its accelerators on Linux. Alt still shows it until the next Alt or a click.
    autoHideMenuBar: true,
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
  const fileMenu: MenuItemConstructorOptions[] = []
  for (const register of features) await register({ window, browsingSession, ipc, fileMenu })
  // Ctrl/Cmd + / - / 0 zoom the chrome UI; navigation scales the page area's insets to match.
  const zoom = (direction: ZoomDirection) => {
    const chromeUi = window.webContents
    chromeUi.setZoomFactor(nextZoomFactor(chromeUi.getZoomFactor(), direction))
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(fileMenu, process.platform, zoom)))

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
