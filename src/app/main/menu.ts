import type { MenuItemConstructorOptions } from 'electron'
import type { ZoomDirection } from './zoom'

/**
 * The View menu: Electron's standard items, with zoom items that call `zoom` (the chrome UI's zoom)
 * instead of Electron's roles. Hidden items add the other usual zoom keys (Ctrl+= and the keypad);
 * hidden items' accelerators still work.
 */
function viewMenu(zoom: (direction: ZoomDirection) => void): MenuItemConstructorOptions[] {
  const item = (
    label: string,
    direction: ZoomDirection,
    accelerator: string,
    visible = true,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => zoom(direction),
    ...(!visible && { visible: false, acceleratorWorksWhenHidden: true }),
  })
  return [
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    { type: 'separator' },
    item('Actual Size', 0, 'CommandOrControl+0'),
    item('Actual Size', 0, 'CommandOrControl+num0', false),
    item('Zoom In', 1, 'CommandOrControl+Plus'),
    item('Zoom In', 1, 'CommandOrControl+=', false),
    item('Zoom In', 1, 'CommandOrControl+numadd', false),
    item('Zoom Out', -1, 'CommandOrControl+-'),
    item('Zoom Out', -1, 'CommandOrControl+numsub', false),
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ]
}

/**
 * The application menu: features' File items plus Electron's standard menus, which keep copy,
 * paste and the other editing shortcuts working in the chrome UI's text fields.
 */
export function appMenuTemplate(
  fileItems: MenuItemConstructorOptions[],
  platform: NodeJS.Platform,
  zoom: (direction: ZoomDirection) => void,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'
  const separator: MenuItemConstructorOptions[] =
    fileItems.length > 0 ? [{ type: 'separator' }] : []
  return [
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    { label: 'File', submenu: [...fileItems, ...separator, { role: mac ? 'close' : 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: viewMenu(zoom) },
    { role: 'windowMenu' },
  ]
}
