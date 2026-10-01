import { describe, expect, it } from 'vitest'
import { nextZoomFactor } from './zoom'

describe('nextZoomFactor', () => {
  it('steps through the listed factors', () => {
    expect(nextZoomFactor(1, 1)).toBe(1.1)
    expect(nextZoomFactor(1.1, 1)).toBe(1.25)
    expect(nextZoomFactor(1, -1)).toBe(0.9)
    expect(nextZoomFactor(0.67, -1)).toBe(0.5)
  })

  it('stays at the ends', () => {
    expect(nextZoomFactor(3, 1)).toBe(3)
    expect(nextZoomFactor(0.5, -1)).toBe(0.5)
  })

  it('moves from a factor between steps to the next step in that direction', () => {
    expect(nextZoomFactor(1.2, 1)).toBe(1.25)
    expect(nextZoomFactor(1.2, -1)).toBe(1.1)
    expect(nextZoomFactor(0.3, 1)).toBe(0.5)
    expect(nextZoomFactor(0.6667, -1)).toBe(0.5)
  })

  it('resets to 100 %', () => {
    expect(nextZoomFactor(2.5, 0)).toBe(1)
  })
})
