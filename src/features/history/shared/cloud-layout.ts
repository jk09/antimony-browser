// Places cloud items (words or pictures) around a centre without overlaps: each item, in the
// order given (heaviest first), goes to the first free spot along an outward spiral.

export interface CloudItem {
  id: string
  width: number
  height: number
}

/** An item's box; x and y are its top-left corner relative to the cloud's centre. */
export interface PlacedItem extends CloudItem {
  x: number
  y: number
}

export interface CloudLayout {
  items: PlacedItem[]
  /** The box around every placed item, relative to the centre. */
  bounds: { left: number; top: number; width: number; height: number }
}

export interface CloudOptions {
  /** Space kept between items. */
  gap?: number
  /** Width-to-height ratio of the spiral, to fill a landscape area. */
  aspect?: number
  /** Positions tried per item before it is left out. */
  maxSteps?: number
}

const overlaps = (a: PlacedItem, b: PlacedItem, gap: number) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap

/** Deterministic: the same items always give the same layout. Items with no free spot are left out. */
export function layoutCloud(items: CloudItem[], options: CloudOptions = {}): CloudLayout {
  const { gap = 4, aspect = 1.6, maxSteps = 6000 } = options
  const placed: PlacedItem[] = []
  for (const item of items) {
    for (let step = 0; step < maxSteps; step++) {
      // Archimedean spiral; the angle step shrinks as the radius grows to keep spacing even.
      const angle = Math.sqrt(step) * 2.2
      const radius = 3 * angle
      const candidate: PlacedItem = {
        ...item,
        x: Math.round(radius * Math.cos(angle) * aspect - item.width / 2),
        y: Math.round(radius * Math.sin(angle) - item.height / 2),
      }
      if (!placed.some((other) => overlaps(candidate, other, gap))) {
        placed.push(candidate)
        break
      }
    }
  }
  if (placed.length === 0) return { items: [], bounds: { left: 0, top: 0, width: 0, height: 0 } }
  const left = Math.min(...placed.map((item) => item.x))
  const top = Math.min(...placed.map((item) => item.y))
  const right = Math.max(...placed.map((item) => item.x + item.width))
  const bottom = Math.max(...placed.map((item) => item.y + item.height))
  return { items: placed, bounds: { left, top, width: right - left, height: bottom - top } }
}

/** Linear size between `min` and `max` for `weight` in [lowest, highest]. */
export function scaleSize(
  weight: number,
  lowest: number,
  highest: number,
  min: number,
  max: number,
): number {
  if (highest <= lowest) return Math.round((min + max) / 2)
  const t = (weight - lowest) / (highest - lowest)
  return Math.round(min + Math.min(1, Math.max(0, t)) * (max - min))
}
