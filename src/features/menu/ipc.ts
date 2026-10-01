export const channels = {
  items: 'menu:items',
  run: 'menu:run',
} as const

/** An application menu item as the chrome UI sees it. Separators and hidden items are left out. */
export interface MenuEntry {
  /** What `/menu` takes for this item: its label in lower case, unique among its siblings. */
  name: string
  label: string
  /** Shortcut for this platform, e.g. `Ctrl+L`. */
  accelerator?: string
  enabled: boolean
  /** Set for submenus. */
  children?: MenuEntry[]
}

export type RunResult = { ok: true } | { ok: false; error: string }

/** Limits on `menu:run`'s path. */
export const MAX_PATH = 8
export const MAX_NAME = 100

export interface MenuApi {
  /** The application menu's items, top-level menus first. */
  items(): Promise<MenuEntry[]>
  /** Runs the item at `path` (names, top-level menu first) as if clicked with the page focused. */
  run(path: string[]): Promise<RunResult>
}
