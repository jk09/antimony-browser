// A theme: values for the chrome UI's colour tokens (src/app/renderer/styles.css :root) and a
// light/dark scheme, checked against WCAG 2.2 AA. Pure; used by main (parsing the model's answer,
// the store) and the UI (applying it).
import { contrast, isHex, repair, type Hex } from './contrast'

export const colorTokens = [
  'toolbar-bg',
  'panel-bg',
  'card-bg',
  'field-bg',
  'code-bg',
  'text',
  'muted',
  'field-border',
  'accent',
  'accent-text',
  'focus',
  'error',
  'ok',
  'cloud-0',
  'cloud-1',
  'cloud-2',
  'cloud-3',
  'cloud-4',
] as const
export type ColorToken = (typeof colorTokens)[number]

export interface Theme {
  name: string
  rationale: string
  scheme: 'light' | 'dark'
  colors: Record<ColorToken, Hex>
}

/** A candidate as the picker shows it: the theme and its lowest text contrast ratio. */
export interface CheckedTheme {
  theme: Theme
  minTextContrast: number
}

export const limits = { name: 40, rationale: 200, description: 300 } as const

/** Throws a TypeError unless `value` is a well-formed theme (hex colours for every token only). */
export function parseTheme(value: unknown): Theme {
  if (typeof value !== 'object' || value === null) throw new TypeError('a theme is an object')
  const record = value as Record<string, unknown>
  const { name, rationale, scheme, colors } = record
  if (typeof name !== 'string' || !name.trim() || name.length > limits.name) {
    throw new TypeError('a theme needs a short name')
  }
  if (typeof rationale !== 'string' || rationale.length > limits.rationale) {
    throw new TypeError('a theme needs a short rationale')
  }
  if (scheme !== 'light' && scheme !== 'dark') throw new TypeError('scheme must be light or dark')
  if (typeof colors !== 'object' || colors === null) throw new TypeError('colors must be an object')
  const given = colors as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (!(colorTokens as readonly string[]).includes(key))
      throw new TypeError(`unknown token ${key}`)
  }
  const parsed = {} as Record<ColorToken, Hex>
  for (const token of colorTokens) {
    const color = given[token]
    if (!isHex(color)) throw new TypeError(`${token} must be a #rrggbb colour`)
    parsed[token] = color.toLowerCase() as Hex
  }
  return { name: name.trim(), rationale: rationale.trim(), scheme, colors: parsed }
}

const backgrounds: ColorToken[] = ['panel-bg', 'card-bg', 'field-bg', 'toolbar-bg']

/** What each foreground must reach (WCAG 2.2 AA) and against which backgrounds. */
const rules: { token: ColorToken; on: ColorToken[]; min: number; text: boolean }[] = [
  { token: 'text', on: [...backgrounds, 'code-bg'], min: 4.5, text: true },
  { token: 'muted', on: backgrounds, min: 4.5, text: true },
  { token: 'error', on: backgrounds, min: 4.5, text: true },
  { token: 'ok', on: backgrounds, min: 4.5, text: true },
  { token: 'accent', on: backgrounds, min: 4.5, text: true },
  { token: 'accent-text', on: ['accent'], min: 4.5, text: true },
  // SC 1.4.11 non-text contrast: focus rings and field borders.
  { token: 'focus', on: ['panel-bg', 'card-bg', 'field-bg'], min: 3, text: false },
  { token: 'field-border', on: ['field-bg', 'panel-bg'], min: 3, text: false },
  ...(['cloud-0', 'cloud-1', 'cloud-2', 'cloud-3', 'cloud-4'] as const).map((token) => ({
    token,
    on: ['card-bg'] as ColorToken[],
    min: 3,
    text: false,
  })),
]

/** The lowest contrast of any text token against its backgrounds. */
export function minTextContrast(theme: Theme): number {
  let lowest = 21
  for (const rule of rules.filter((r) => r.text)) {
    for (const bg of rule.on) {
      lowest = Math.min(lowest, contrast(theme.colors[rule.token], theme.colors[bg]))
    }
  }
  return lowest
}

/**
 * The theme with every failing foreground repaired to WCAG 2.2 AA (text 4.5:1, non-text 3:1),
 * or null when some colour can't be repaired. `accent-text` is checked after `accent` moved.
 */
export function checkTheme(theme: Theme): CheckedTheme | null {
  const colors = { ...theme.colors }
  for (const rule of rules) {
    const fixed = repair(
      colors[rule.token],
      rule.on.map((bg) => colors[bg]),
      rule.min,
    )
    if (!fixed) return null
    colors[rule.token] = fixed
  }
  const checked = { ...theme, colors }
  return { theme: checked, minTextContrast: minTextContrast(checked) }
}

/** CSS custom properties for a theme, including the derived translucent tokens. */
export function themeProperties(theme: Theme): Record<string, string> {
  const properties: Record<string, string> = {}
  for (const token of colorTokens) properties[`--${token}`] = theme.colors[token]
  const text = theme.colors.text
  const rgb = [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16)).join(', ')
  properties['--card-border'] = `rgba(${rgb}, 0.14)`
  properties['--hover'] = `rgba(${rgb}, 0.07)`
  return properties
}
