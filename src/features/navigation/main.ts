import { WebContentsView } from 'electron'
import type { MainContext } from '../../app/main/features'
import { secureWebPreferences } from '../../app/main/security'
import { channels } from './ipc'
import { isWebUrl, toUrl } from './shared/to-url'

/** Must match `--toolbar-height` in src/app/renderer/styles.css. */
export const TOOLBAR_HEIGHT = 40

export function register({ window, browsingSession, ipc, fileMenu }: MainContext): void {
  const page = new WebContentsView({
    webPreferences: { ...secureWebPreferences, session: browsingSession },
  })
  const guard = (event: Electron.Event<{ url: string }>) => {
    if (!isWebUrl(event.url)) event.preventDefault()
  }
  page.webContents.on('will-navigate', guard)
  page.webContents.on('will-redirect', guard)

  const layout = () => {
    const [width = 0, height = 0] = window.getContentSize()
    page.setBounds({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - TOOLBAR_HEIGHT),
    })
  }

  // The placeholder in the chrome UI stays visible until the first page is loaded.
  let shown = false
  const show = () => {
    if (shown) return
    shown = true
    window.contentView.addChildView(page)
    layout()
    window.on('resize', layout)
  }

  ipc.handle(channels.go, (input) => {
    const url = typeof input === 'string' ? toUrl(input) : null
    if (url === null) throw new TypeError(`${channels.go} expects an http(s) URL`)
    show()
    page.webContents.loadURL(url).catch((error: unknown) => {
      console.warn(`Failed to load ${url}`, error)
    })
    page.webContents.focus()
  })

  fileMenu.push({
    id: 'open-location',
    label: 'Open Location…',
    accelerator: 'CmdOrCtrl+L',
    click: () => {
      // The page view may have focus; the text box lives in the chrome UI.
      window.webContents.focus()
      ipc.send(channels.openLocation, null)
    },
  })
}
