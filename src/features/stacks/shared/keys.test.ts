import { describe, expect, it } from 'vitest'
import { cycleKeyFor, shortcutLabel, stackCommandFor, type KeyInput } from './keys'

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  key: k,
  control: true,
  meta: false,
  alt: false,
  shift: false,
  isAutoRepeat: false,
  ...extra,
})

describe('stack shortcuts', () => {
  it('maps Ctrl+R, +N and +W off macOS and Cmd on macOS', () => {
    expect(stackCommandFor(key('r'), 'linux')).toBe('reload')
    expect(stackCommandFor(key('N'), 'win32')).toBe('new')
    expect(stackCommandFor(key('w'), 'linux')).toBe('close-page')
    expect(stackCommandFor(key('E'), 'linux')).toBe('focus-tree')
    expect(stackCommandFor(key('w'), 'darwin')).toBeNull()
    expect(stackCommandFor(key('w', { control: false, meta: true }), 'darwin')).toBe('close-page')
  })

  it('ignores other keys, modifiers, key-ups and repeats', () => {
    expect(stackCommandFor(key('b'), 'linux')).toBeNull()
    expect(stackCommandFor(key('r', { shift: true }), 'linux')).toBeNull()
    expect(stackCommandFor(key('r', { alt: true }), 'linux')).toBeNull()
    expect(stackCommandFor(key('r', { type: 'keyUp' }), 'linux')).toBeNull()
    expect(stackCommandFor(key('w', { isAutoRepeat: true }), 'linux')).toBeNull()
    expect(stackCommandFor(key('r', { control: false }), 'linux')).toBeNull()
  })

  it('labels the shortcuts per platform', () => {
    expect(shortcutLabel('reload', 'linux')).toBe('Ctrl+R')
    expect(shortcutLabel('new', 'darwin')).toBe('Cmd+N')
    expect(shortcutLabel('close-page', 'win32')).toBe('Ctrl+W')
    expect(shortcutLabel('focus-tree', 'darwin')).toBe('Cmd+E')
  })

  it('maps the Ctrl+Tab cycle keys', () => {
    expect(cycleKeyFor(key('Tab'))).toBe('next')
    expect(cycleKeyFor(key('Tab', { isAutoRepeat: true }))).toBe('next')
    expect(cycleKeyFor(key('Tab', { shift: true }))).toBe('previous')
    expect(cycleKeyFor(key('Tab', { control: false }))).toBeNull()
    expect(cycleKeyFor(key('Tab', { meta: true }))).toBeNull()
    expect(cycleKeyFor(key('Control', { type: 'keyUp', control: false }))).toBe('release')
    expect(cycleKeyFor(key('Tab', { type: 'keyUp' }))).toBeNull()
    expect(cycleKeyFor(key('Escape', { control: false }))).toBe('escape')
    expect(cycleKeyFor(key('r'))).toBeNull()
  })
})
