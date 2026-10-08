import { describe, expect, it } from 'vitest'
import { crosses, type Box } from './map-layout'
import { createRouter, roundedPath, simplify, type Point, type RoutingContext } from './map-routing'

const frame = (x: number): Box => ({ x, y: 0, width: 100, height: 100 })
const page = (x: number): Box => ({ x: x + 20, y: 40, width: 60, height: 20 })

// Three groups side by side; the page of group 1 links to the page of group 3, with group 2 between.
const context = (area: Box): RoutingContext => ({
  nodes: new Map([
    [1, page(0)],
    [2, page(140)],
    [3, page(280)],
  ]),
  frames: new Map([
    [1, frame(0)],
    [2, frame(140)],
    [3, frame(280)],
  ]),
  groupOf: new Map([
    [1, 1],
    [2, 2],
    [3, 3],
  ]),
  area,
})
const roomy: Box = { x: -40, y: -40, width: 460, height: 180 }

const segments = (route: Point[]) => route.slice(1).map((end, i) => [route[i]!, end] as const)

describe('createRouter', () => {
  it('runs an edge around a group in between and never over a page or another group', () => {
    const ctx = context(roomy)
    const route = createRouter(ctx)(1, 3)!
    expect(route).not.toBeNull()
    for (const [from, to] of segments(route)) {
      expect(crosses(from, to, ctx.frames.get(2)!), 'through the middle group').toBe(false)
      expect(crosses(from, to, ctx.nodes.get(2)!), 'over the middle page').toBe(false)
    }
  })

  it('starts and ends on the borders of the two pages', () => {
    const ctx = context(roomy)
    const route = createRouter(ctx)(1, 3)!
    const onBorder = (point: Point, box: Box) => {
      const insideX = point.x >= box.x - 0.01 && point.x <= box.x + box.width + 0.01
      const insideY = point.y >= box.y - 0.01 && point.y <= box.y + box.height + 0.01
      const onSide =
        Math.abs(point.x - box.x) < 0.01 ||
        Math.abs(point.x - box.x - box.width) < 0.01 ||
        Math.abs(point.y - box.y) < 0.01 ||
        Math.abs(point.y - box.y - box.height) < 0.01
      return insideX && insideY && onSide
    }
    expect(onBorder(route[0]!, ctx.nodes.get(1)!)).toBe(true)
    expect(onBorder(route[route.length - 1]!, ctx.nodes.get(3)!)).toBe(true)
  })

  it('is deterministic and the same for repeated calls', () => {
    const router = createRouter(context(roomy))
    const first = router(1, 3)
    expect(router(1, 3)).toEqual(first)
    expect(createRouter(context(roomy))(1, 3)).toEqual(first)
  })

  it('finds no route when there is no gap around the group in between', () => {
    expect(createRouter(context({ x: 0, y: 0, width: 380, height: 100 }))(1, 3)).toBeNull()
  })

  it('routes between neighbouring groups and refuses unknown pages or a map that is too large', () => {
    const ctx = context(roomy)
    expect(createRouter(ctx)(1, 2)).not.toBeNull()
    expect(createRouter(ctx)(1, 99)).toBeNull()
    expect(createRouter(ctx, { maxCells: 10 })(1, 3)).toBeNull()
  })
})

describe('simplify and roundedPath', () => {
  it('drops points in straight runs and repeats', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
  })

  it('rounds corners without leaving the lines', () => {
    expect(roundedPath([])).toBe('')
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ]),
    ).toBe('M0 0 L14 0 Q20 0 20 6 L20 20')
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ]),
    ).toBe('M0 0 L2 0 Q4 0 4 2 L4 4')
  })
})
