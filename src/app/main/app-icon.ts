import { join } from 'node:path'
import { app, nativeImage, nativeTheme, type BrowserWindow } from 'electron'

/** The icon PNG for the system theme; rendered from the SVGs by scripts/render-icons.mjs. */
export function iconPath(dark: boolean, appPath = app.getAppPath()): string {
  return join(appPath, 'resources/icons', `antimony-${dark ? 'dark' : 'light'}.png`)
}

/**
 * Shows the light or dark mountain icon on the window (Windows, Linux) or the dock (macOS) to match
 * the system theme, and swaps it when the theme changes. A missing file keeps Electron's icon.
 */
export function applyAppIcon(window: BrowserWindow): void {
  let shownDark: boolean | null = null
  const update = () => {
    const dark = nativeTheme.shouldUseDarkColors
    if (dark === shownDark || window.isDestroyed()) return
    const image = nativeImage.createFromPath(iconPath(dark))
    if (image.isEmpty()) return
    shownDark = dark
    if (process.platform === 'darwin') app.dock?.setIcon(image)
    else window.setIcon(image)
  }
  update()
  nativeTheme.on('updated', update)
  window.once('closed', () => nativeTheme.off('updated', update))
}
