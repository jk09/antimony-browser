import { app, type Session, type WebContents, type WebPreferences } from 'electron'
import { isChromeUiUrl } from './chrome-ui-url'

/**
 * webPreferences for every WebContents the app creates, chrome UI and web pages alike.
 * Weakening any of these needs an ADR.
 */
export const secureWebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
  allowRunningInsecureContent: false,
  navigateOnDragDrop: false,
} as const satisfies WebPreferences

/** App-wide defaults for every WebContents. Features override the window-open handler per view. */
export function hardenApp(): void {
  // --no-sandbox is honoured like in Chrome (needed when running as root, e.g. in containers).
  if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox()
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

/** Locks the chrome UI to its own document and denies it every permission. */
export function hardenChromeUi(contents: WebContents, chromeUiUrl: string): void {
  const guard = (event: Electron.Event<{ url: string }>) => {
    if (!isChromeUiUrl(event.url, chromeUiUrl)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  denyAllPermissions(contents.session)
}

/** Web pages get no permissions until a feature (with a spec) grants them explicitly. */
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
}
