import { describe, expect, it } from 'vitest'
import { layoutMap, type Box, type MapLayoutGroup } from './map-layout'

const group = (id: number, count: number, first = id * 100): MapLayoutGroup => ({
  id,
  nodes: Array.from({ length: count }, (_, index) => ({
    id: first + index,
    width: 120,
    height: 28,
  })),
})

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('layoutMap', () => {
  const groups = [group(1, 9), group(2, 4), group(3, 3), group(0, 5), group(4, 1)]

  it('never overlaps groups or pages and keeps pages inside their group', () => {
    const layout = layoutMap(groups)
    expect(layout.nodes.size).toBe(22)
    layout.groups.forEach((a, i) => {
      layout.groups.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false))
    })
    const boxes = [...layout.nodes.values()]
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)))
    for (const { id, nodes } of groups) {
      const frame = layout.groups.find((placed) => placed.id === id)!
      for (const node of nodes) {
        const box = layout.nodes.get(node.id)!
        expect(box.x).toBeGreaterThanOrEqual(frame.x)
        expect(box.y).toBeGreaterThanOrEqual(frame.y)
        expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width)
        expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height)
      }
    }
  })

  it('is deterministic and bounds everything', () => {
    const a = layoutMap(groups)
    expect(layoutMap(groups)).toEqual(a)
    for (const placed of a.groups) {
      expect(placed.x + placed.width).toBeLessThanOrEqual(a.bounds.width)
      expect(placed.y + placed.height).toBeLessThanOrEqual(a.bounds.height)
    }
  })

  it('handles no pages', () => {
    expect(layoutMap([group(1, 0)])).toEqual({
      groups: [],
      nodes: new Map(),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    })
  })
})
