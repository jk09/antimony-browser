// Pure helpers for turning menu items into `/menu` names and finding them again.

/** Removes mnemonic markers (`&File` → `File`, `&&` → `&`). */
export function cleanLabel(label: string): string {
  return label.replace(/&(&?)/g, (_, double: string) => double)
}

/** `Zoom In` → `zoom-in`, `Open Location…` → `open-location`. */
export function nameOf(label: string): string {
  const name = cleanLabel(label)
    .toLowerCase()
    .replace(/…|\.\.\./g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return name || 'item'
}

/** Names for sibling labels, with `-2`, `-3`… for repeats. */
export function uniqueNames(labels: string[]): string[] {
  const used = new Set<string>()
  return labels.map((label) => {
    const base = nameOf(label)
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`
    used.add(name)
    return name
  })
}

/** An Electron accelerator as the user presses it on `platform`: `CmdOrCtrl+L` → `Ctrl+L`. */
export function formatAccelerator(accelerator: string, platform: string): string {
  const mac = platform === 'darwin'
  return accelerator
    .split('+')
    .map((key) => {
      switch (key.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
          return mac ? 'Cmd' : 'Ctrl'
        case 'command':
        case 'cmd':
          return 'Cmd'
        case 'control':
        case 'ctrl':
          return 'Ctrl'
        case 'option':
        case 'alt':
          return mac ? 'Option' : 'Alt'
        default:
          return key
      }
    })
    .join('+')
}

export interface NamedNode<T> {
  name: string
  label: string
  enabled: boolean
  children?: T[]
}

const choices = (nodes: NamedNode<unknown>[]) => nodes.map((node) => node.name).join(', ')

/** Finds the runnable item at `path`, or says why there is none and what can be picked instead. */
export function resolve<T extends NamedNode<T>>(
  roots: T[],
  path: string[],
): { item: T; labels: string[] } | { error: string } {
  let level = roots
  const labels: string[] = []
  for (const [index, segment] of path.entries()) {
    const node = level.find((candidate) => candidate.name === segment.toLowerCase())
    if (!node) {
      const where = labels.length ? `in ${labels.join(' › ')}` : 'among the menus'
      return { error: `No “${segment}” ${where}. Pick one of: ${choices(level)}.` }
    }
    labels.push(node.label)
    if (!node.children) {
      if (index < path.length - 1) return { error: `${labels.join(' › ')} has no items.` }
      if (!node.enabled) return { error: `${labels.join(' › ')} is disabled.` }
      return { item: node, labels }
    }
    level = node.children
  }
  return { error: `${labels.join(' › ') || 'The menu'} has items. Pick one of: ${choices(level)}.` }
}
