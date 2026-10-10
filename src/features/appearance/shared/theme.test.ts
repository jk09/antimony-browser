import { describe, expect, it } from 'vitest'
import { sampleTheme } from './sample-theme'
import { contrast } from './contrast'
import {
  checkTheme,
  colorTokens,
  minTextContrast,
  parseTheme,
  themeProperties,
  type Theme,
} from './theme'

describe('parseTheme', () => {
  it('accepts a complete theme and lowercases its colours', () => {
    const theme = sampleTheme()
    const parsed = parseTheme({
      ...theme,
      colors: { ...theme.colors, text: '#26282B' },
    })
    expect(parsed.colors.text).toBe('#26282b')
    expect(Object.keys(parsed.colors)).toEqual([...colorTokens])
  })

  it('rejects missing or unknown tokens, non-hex values and over-long text', () => {
    const theme = sampleTheme()
    const { text: _text, ...missing } = theme.colors
    for (const bad of [
      null,
      { ...theme, colors: missing },
      { ...theme, colors: { ...theme.colors, extra: '#000000' } },
      { ...theme, colors: { ...theme.colors, text: 'black' } },
      { ...theme, colors: { ...theme.colors, text: 'url(x)' } },
      { ...theme, scheme: 'sepia' },
      { ...theme, name: '' },
      { ...theme, name: 'x'.repeat(41) },
      { ...theme, rationale: 'x'.repeat(201) },
    ]) {
      expect(() => parseTheme(bad), JSON.stringify(bad)).toThrow(TypeError)
    }
  })
})

describe('checkTheme', () => {
  it('keeps a theme that passes WCAG 2.2 AA and reports its lowest text contrast', () => {
    const theme = sampleTheme()
    const checked = checkTheme(theme)!
    expect(checked.theme).toEqual(theme)
    expect(checked.minTextContrast).toBeGreaterThanOrEqual(4.5)
    expect(checked.minTextContrast).toBe(minTextContrast(theme))
  })

  it('repairs failing text, button text, focus ring, borders and cloud colours', () => {
    const theme = sampleTheme()
    const weak = {
      ...theme,
      colors: {
        ...theme.colors,
        muted: '#b0b0b0',
        accent: '#7fb0ff',
        'accent-text': '#9fc0ff',
        focus: '#d0e0ff',
        'field-border': '#eeeeee',
        'cloud-3': '#f0e0ff',
      },
    }
    const { theme: fixed, minTextContrast: lowest } = checkTheme(weak as Theme)!
    const c = fixed.colors
    for (const bg of [c['panel-bg'], c['card-bg'], c['field-bg'], c['toolbar-bg']]) {
      expect(contrast(c.muted, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.accent, bg)).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(c['accent-text'], c.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c.focus, c['panel-bg'])).toBeGreaterThanOrEqual(3)
    expect(contrast(c['field-border'], c['field-bg'])).toBeGreaterThanOrEqual(3)
    expect(contrast(c['cloud-3'], c['card-bg'])).toBeGreaterThanOrEqual(3)
    expect(lowest).toBeGreaterThanOrEqual(4.5)
  })

  it('drops a theme whose text cannot be readable on all its backgrounds', () => {
    const theme = sampleTheme()
    expect(
      checkTheme({
        ...theme,
        colors: {
          ...theme.colors,
          'toolbar-bg': '#000000',
          'panel-bg': '#ffffff',
          'card-bg': '#767676',
        },
      }),
    ).toBeNull()
  })
})

describe('themeProperties', () => {
  it('sets every token and derives the translucent ones from the text colour', () => {
    const properties = themeProperties(sampleTheme())
    expect(properties['--panel-bg']).toBe('#f7f5f0')
    expect(properties['--card-border']).toBe('rgba(38, 40, 43, 0.14)')
    expect(properties['--hover']).toBe('rgba(38, 40, 43, 0.07)')
    expect(Object.keys(properties)).toHaveLength(colorTokens.length + 2)
  })
})
