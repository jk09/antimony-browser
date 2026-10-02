// The stack shortcuts. Pure: no electron, Node or React imports.
import type { StackCommand } from '../ipc'

/** The parts of Electron's `Input` the shortcuts look at. */
export interface KeyInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat: boolean
}

const KEYS: Record<string, StackCommand> = { r: 'reload', n: 'new', w: 'close-page' }

/** Ctrl/Cmd+R, +N or +W pressed (not held) → its command, else null. */
export function stackCommandFor(input: KeyInput, platform: string): StackCommand | null {
  const command =
    platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (input.type !== 'keyDown' || input.isAutoRepeat || !command || input.alt || input.shift) {
    return null
  }
  return KEYS[input.key.toLowerCase()] ?? null
}

/** How the shortcut of `command` reads on `platform`: `Ctrl+R`, `Cmd+R`. */
export function shortcutLabel(command: StackCommand, platform: string): string {
  const key = Object.keys(KEYS).find((candidate) => KEYS[candidate] === command)!
  return `${platform === 'darwin' ? 'Cmd' : 'Ctrl'}+${key.toUpperCase()}`
}
