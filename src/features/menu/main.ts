import { Menu, type MenuItem } from 'electron'
import type { MainContext } from '../../app/main/features'
import { getPage } from '../navigation/main'
import { channels, MAX_NAME, MAX_PATH, type MenuEntry, type RunResult } from './ipc'
import { cleanLabel, formatAccelerator, resolve, uniqueNames } from './shared/names'

interface Node extends MenuEntry {
  item: MenuItem
  children?: Node[]
}

/** The menu's visible items as a tree; separators and hidden items are left out. */
export function menuTree(menu: Menu | null, platform: string): Node[] {
  const items = (menu?.items ?? []).filter((item) => item.visible && item.type !== 'separator')
  const labels = items.map((item) => cleanLabel(item.label || item.role || ''))
  const names = uniqueNames(labels)
  return items.map((item, index) => ({
    item,
    name: names[index]!,
    label: labels[index]!,
    ...(typeof item.accelerator === 'string' && {
      accelerator: formatAccelerator(item.accelerator, platform),
    }),
    enabled: item.enabled,
    ...(item.submenu && { children: menuTree(item.submenu, platform) }),
  }))
}

/** The tree without Electron objects, for IPC. */
function entries(nodes: Node[]): MenuEntry[] {
  return nodes.map(({ item: _, children, ...entry }) => ({
    ...entry,
    ...(children && { children: entries(children) }),
  }))
}

export function parsePath(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_PATH ||
    !value.every((name) => typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME)
  ) {
    throw new TypeError(
      `${channels.run} expects 1–${MAX_PATH} names of at most ${MAX_NAME} characters`,
    )
  }
  return value as string[]
}

export function register({ window, ipc }: MainContext): void {
  const tree = () => menuTree(Menu.getApplicationMenu(), process.platform)

  ipc.handle(channels.items, () => entries(tree()))
  ipc.handle(channels.run, (value): RunResult => {
    const found = resolve(tree(), parsePath(value))
    if ('error' in found) return { ok: false, error: found.error }
    // As if clicked in the menu bar with the page focused: Edit items act on the page, not on the
    // prompt that was just used to run them. Items with their own click ignore the target.
    const target = getPage()?.contents() ?? window.webContents
    try {
      ;(found.item.item.click as (...args: unknown[]) => void)({}, window, target)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: `${found.labels.join(' › ')} failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  })
}
