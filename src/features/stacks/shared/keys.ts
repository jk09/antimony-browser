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

const KEYS: Record<string, StackCommand> = {
  r: 'reload',
  n: 'new',
  w: 'close-page',
  e: 'focus-tree',
}

/** A key of the Ctrl+Tab stack cycle. */
export type CycleKey = 'next' | 'previous' | 'release' | 'escape'

/** Ctrl/Cmd+R, +N, +W or +E pressed (not held) → its command, else null. */
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

/**
 * Ctrl+Tab → next, Ctrl+Shift+Tab → previous (Ctrl on every platform, repeats included), the
 * Control key going up → release, Escape → escape; else null.
 */
export function cycleKeyFor(input: KeyInput): CycleKey | null {
  if (input.type === 'keyUp') return input.key === 'Control' ? 'release' : null
  if (input.type !== 'keyDown') return null
  if (input.key === 'Escape') return 'escape'
  if (input.key !== 'Tab' || !input.control || input.meta || input.alt) return null
  return input.shift ? 'previous' : 'next'
}
