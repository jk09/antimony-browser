import { describe, expect, it } from 'vitest'
import { contrast, isHex, luminance, repair } from './contrast'

describe('WCAG contrast', () => {
  it('computes relative luminance and ratios as WCAG defines them', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBe(1)
    expect(contrast('#000000', '#ffffff')).toBe(21)
    expect(contrast('#ffffff', '#000000')).toBe(21)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrast('#0000ff', '#ffffff')).toBeCloseTo(8.59, 2)
  })

  it('accepts only #rrggbb', () => {
    expect(isHex('#a1B2c3')).toBe(true)
    for (const bad of ['#abc', 'red', 'rgb(0,0,0)', '#12345g', 42, null]) {
      expect(isHex(bad), String(bad)).toBe(false)
    }
  })

  it('repairs a colour just enough, darker on light and lighter on dark backgrounds', () => {
    expect(repair('#222222', ['#ffffff'], 4.5)).toBe('#222222')
    const darker = repair('#999999', ['#ffffff', '#f5f5f5'], 4.5)!
    expect(contrast(darker, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(darker, '#f5f5f5')).toBeGreaterThanOrEqual(4.5)
    expect(luminance(darker)).toBeLessThan(luminance('#999999'))
    const lighter = repair('#555555', ['#121212'], 4.5)!
    expect(contrast(lighter, '#121212')).toBeGreaterThanOrEqual(4.5)
    expect(luminance(lighter)).toBeGreaterThan(luminance('#555555'))
    // Keeps the hue: a repaired blue stays blue.
    const blue = repair('#8ab4f8', ['#ffffff'], 4.5)!
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(blue.slice(i, i + 2), 16)) as number[]
    expect(b).toBeGreaterThan(r!)
    expect(b).toBeGreaterThan(g!)
  })

  it('gives up when no lightness passes against every background', () => {
    // Mid grey (#767676) still reaches 4.5:1 against both black and white; 7:1 can't.
    expect(repair('#808080', ['#000000', '#ffffff'], 4.5)).toBe('#767676')
    expect(repair('#808080', ['#000000', '#ffffff'], 7)).toBeNull()
  })
})
