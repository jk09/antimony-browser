// WCAG 2.2 contrast: relative luminance of sRGB colours and the ratio between two of them
// (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio), plus a repair that keeps a colour's hue.

export type Hex = `#${string}`

const HEX = /^#[0-9a-f]{6}$/

export const isHex = (value: unknown): value is Hex =>
  typeof value === 'string' && HEX.test(value.toLowerCase())

function channels(hex: Hex): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const toHex = (rgb: number[]): Hex =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: Hex): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function toHsl(hex: Hex): [number, number, number] {
  const [r, g, b] = channels(hex).map((c) => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function fromHsl(h: number, s: number, l: number): Hex {
  if (s === 0) return toHex([l * 255, l * 255, l * 255])
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return toHex([hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255])
}

/**
 * `color` with its lightness moved (toward black on light backgrounds, toward white on dark
 * ones) just far enough to reach `min` against every background, keeping hue and saturation;
 * null when even black or white can't.
 */
export function repair(color: Hex, backgrounds: Hex[], min: number): Hex | null {
  const passes = (candidate: Hex) => backgrounds.every((bg) => contrast(candidate, bg) >= min)
  if (passes(color)) return color
  const average = backgrounds.reduce((sum, bg) => sum + luminance(bg), 0) / backgrounds.length
  // Toward the side with more room: darker on light backgrounds, lighter on dark ones.
  const direction = average > 0.18 ? -1 : 1
  const [h, s, l] = toHsl(color)
  for (let step = 1; step <= 100; step++) {
    const next = Math.min(1, Math.max(0, l + (direction * step) / 100))
    const candidate = fromHsl(h, s, next)
    if (passes(candidate)) return candidate
    if (next === 0 || next === 1) break
  }
  return null
}
