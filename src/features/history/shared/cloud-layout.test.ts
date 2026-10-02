import { describe, expect, it } from 'vitest'
import { layoutCloud, scaleSize, type PlacedItem } from './cloud-layout'

const items = Array.from({ length: 60 }, (_, i) => ({
  id: `w${i}`,
  width: 40 + ((i * 37) % 120),
  height: 16 + ((i * 11) % 30),
}))

const overlap = (a: PlacedItem, b: PlacedItem) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const distance = (item: PlacedItem) => Math.hypot(item.x + item.width / 2, item.y + item.height / 2)

describe('cloud layout', () => {
  it('places every item without overlaps', () => {
    const { items: placed } = layoutCloud(items)
    expect(placed.map((item) => item.id)).toEqual(items.map((item) => item.id))
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlap(placed[i]!, placed[j]!), `${placed[i]!.id} / ${placed[j]!.id}`).toBe(false)
      }
    }
  })

  it('puts the first (heaviest) item in the middle and later ones further out', () => {
    const { items: placed } = layoutCloud(items)
    expect(distance(placed[0]!)).toBeLessThan(1)
    const inner = placed.slice(0, 10).map(distance)
    const outer = placed.slice(-10).map(distance)
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
    expect(mean(inner)).toBeLessThan(mean(outer))
  })

  it('is deterministic and reports the bounds of what it placed', () => {
    const a = layoutCloud(items)
    expect(layoutCloud(items)).toEqual(a)
    const { left, top, width, height } = a.bounds
    for (const item of a.items) {
      expect(item.x).toBeGreaterThanOrEqual(left)
      expect(item.y).toBeGreaterThanOrEqual(top)
      expect(item.x + item.width).toBeLessThanOrEqual(left + width)
      expect(item.y + item.height).toBeLessThanOrEqual(top + height)
    }
    expect(layoutCloud([])).toEqual({ items: [], bounds: { left: 0, top: 0, width: 0, height: 0 } })
  })

  it('lays out 60 words quickly', () => {
    const start = performance.now()
    layoutCloud(items)
    expect(performance.now() - start).toBeLessThan(200)
  })

  it('scales sizes linearly between the lowest and highest weight', () => {
    expect(scaleSize(1, 1, 3, 10, 50)).toBe(10)
    expect(scaleSize(2, 1, 3, 10, 50)).toBe(30)
    expect(scaleSize(3, 1, 3, 10, 50)).toBe(50)
    expect(scaleSize(5, 5, 5, 10, 50)).toBe(30)
  })
})
