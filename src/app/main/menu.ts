import type { MenuItemConstructorOptions } from 'electron'

/**
 * The application menu: features' File items plus Electron's standard menus, which keep copy,
 * paste and the other editing shortcuts working in the chrome UI's text fields.
 */
export function appMenuTemplate(
  fileItems: MenuItemConstructorOptions[],
  platform: NodeJS.Platform,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'
  const separator: MenuItemConstructorOptions[] =
    fileItems.length > 0 ? [{ type: 'separator' }] : []
  return [
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    { label: 'File', submenu: [...fileItems, ...separator, { role: mac ? 'close' : 'quit' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
}
