// Routes the map's edges between groups through the gaps between boxes: a search on a coarse grid
// where other groups and every page are obstacles, so an arrow never runs over a page or through a
// group it doesn't belong to. Pure and deterministic, like the layout it works on.
import type { Box } from './map-layout'

export interface Point {
  x: number
  y: number
}

export interface RoutingContext {
  /** Every page's box, by page id. */
  nodes: Map<number, Box>
  /** Every group's frame, by group id. */
  frames: Map<number, Box>
  /** The group of each page. */
  groupOf: Map<number, number>
  /** The area the routes may use (the layout's bounds plus a margin). */
  area: Box
}

export interface RoutingOptions {
  /** Side of a grid cell, in map units. */
  cell?: number
  /** How far routes keep from pages. */
  clearance?: number
  /** Extra cost of turning, in cells: fewer bends. */
  turn?: number
  /** Largest grid searched; a bigger map gets no routes (callers draw straight curves). */
  maxCells?: number
}

const DEFAULTS = { cell: 4, clearance: 2, turn: 3, maxCells: 400_000 }
const DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const inside = (point: Point, box: Box) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height

/** The point of `box`'s border nearest to `point` (a point inside is pushed out to the nearest side). */
function clampToBorder(point: Point, box: Box): Point {
  const right = box.x + box.width
  const bottom = box.y + box.height
  const strictlyInside = point.x > box.x && point.x < right && point.y > box.y && point.y < bottom
  if (!strictlyInside) {
    return {
      x: Math.min(right, Math.max(box.x, point.x)),
      y: Math.min(bottom, Math.max(box.y, point.y)),
    }
  }
  const nearest = Math.min(point.x - box.x, right - point.x, point.y - box.y, bottom - point.y)
  if (nearest === point.x - box.x) return { x: box.x, y: point.y }
  if (nearest === right - point.x) return { x: right, y: point.y }
  if (nearest === point.y - box.y) return { x: point.x, y: box.y }
  return { x: point.x, y: bottom }
}

/** A binary min-heap of [priority, value] pairs. */
class Heap {
  private readonly keys: number[] = []
  private readonly values: number[] = []
  get size() {
    return this.keys.length
  }
  push(key: number, value: number) {
    let i = this.keys.length
    this.keys.push(key)
    this.values.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent]! <= key) break
      this.keys[i] = this.keys[parent]!
      this.values[i] = this.values[parent]!
      i = parent
    }
    this.keys[i] = key
    this.values[i] = value
  }
  pop(): number {
    const top = this.values[0]!
    const key = this.keys.pop()!
    const value = this.values.pop()!
    const n = this.keys.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= n) break
        if (child + 1 < n && this.keys[child + 1]! < this.keys[child]!) child++
        if (this.keys[child]! >= key) break
        this.keys[i] = this.keys[child]!
        this.values[i] = this.values[child]!
        i = child
      }
      this.keys[i] = key
      this.values[i] = value
    }
    return top
  }
}

/** Finds routes for edges between pages, or null for an edge that can't be routed. */
export function createRouter(context: RoutingContext, options: RoutingOptions = {}) {
  const { cell, clearance, turn, maxCells } = { ...DEFAULTS, ...options }
  const { area } = context
  const cols = Math.ceil(area.width / cell) + 1
  const rows = Math.ceil(area.height / cell) + 1
  if (cols * rows > maxCells) return () => null

  const centre = (col: number, row: number): Point => ({
    x: area.x + col * cell + cell / 2,
    y: area.y + row * cell + cell / 2,
  })
  // Which page (index + 1) and which group (index + 1) covers a cell; 0 for neither.
  const pageAt = new Int32Array(cols * rows)
  const groupAt = new Int32Array(cols * rows)
  const pageIds = [...context.nodes.keys()]
  const pageIndex = new Map(pageIds.map((id, index) => [id, index + 1]))
  const groupIds = [...context.frames.keys()]
  const groupIndex = new Map(groupIds.map((id, index) => [id, index + 1]))
  const paint = (target: Int32Array, box: Box, value: number, grow: number) => {
    const c0 = Math.max(0, Math.floor((box.x - grow - area.x) / cell))
    const c1 = Math.min(cols - 1, Math.floor((box.x + box.width + grow - area.x) / cell))
    const r0 = Math.max(0, Math.floor((box.y - grow - area.y) / cell))
    const r1 = Math.min(rows - 1, Math.floor((box.y + box.height + grow - area.y) / cell))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) target[r * cols + c] = value
  }
  for (const [id, frame] of context.frames) paint(groupAt, frame, groupIndex.get(id)!, 0)
  for (const [id, box] of context.nodes) paint(pageAt, box, pageIndex.get(id)!, clearance)

  const seen = new Int32Array(cols * rows * 4)
  const cost = new Float32Array(cols * rows * 4)
  const parent = new Int32Array(cols * rows * 4)
  let stamp = 0

  return (from: number, to: number): Point[] | null => {
    const [a, b] = [context.nodes.get(from), context.nodes.get(to)]
    const [groupA, groupB] = [context.groupOf.get(from), context.groupOf.get(to)]
    if (!a || !b || groupA === undefined || groupB === undefined) return null
    const [pageA, pageB] = [pageIndex.get(from)!, pageIndex.get(to)!]
    const [frameA, frameB] = [groupIndex.get(groupA) ?? 0, groupIndex.get(groupB) ?? 0]
    const passable = (col: number, row: number) => {
      const i = row * cols + col
      const page = pageAt[i]!
      const group = groupAt[i]!
      if (page !== 0 && page !== pageA && page !== pageB) return false
      if (group !== 0 && group !== frameA && group !== frameB) return false
      const p = centre(col, row)
      return !inside(p, a) && !inside(p, b)
    }
    const aim = clampToBorder({ x: a.x + a.width / 2, y: a.y + a.height / 2 }, b)
    const estimate = (col: number, row: number) => {
      const p = centre(col, row)
      return (Math.abs(p.x - aim.x) + Math.abs(p.y - aim.y)) / cell
    }

    stamp++
    const heap = new Heap()
    const state = (col: number, row: number, dir: number) => (row * cols + col) * 4 + dir
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (pageAt[row * cols + col] !== pageA || !passable(col, row)) continue
        for (let dir = 0; dir < 4; dir++) {
          const s = state(col, row, dir)
          seen[s] = stamp
          cost[s] = 0
          parent[s] = -1
          heap.push(estimate(col, row), s)
        }
      }
    }
    while (heap.size > 0) {
      const s = heap.pop()
      const dir = s % 4
      const index = (s - dir) / 4
      const col = index % cols
      const row = (index - col) / cols
      if (pageAt[index] === pageB) {
        const cells: Point[] = []
        for (let at = s; at !== -1; at = parent[at]!) {
          const i = (at - (at % 4)) / 4
          cells.push(centre(i % cols, Math.floor(i / cols)))
        }
        cells.reverse()
        const points = [
          clampToBorder(cells[0]!, a),
          ...cells,
          clampToBorder(cells[cells.length - 1]!, b),
        ]
        return simplify(points)
      }
      for (let next = 0; next < 4; next++) {
        const [dc, dr] = DIRECTIONS[next]!
        const [c, r] = [col + dc, row + dr]
        if (c < 0 || r < 0 || c >= cols || r >= rows || !passable(c, r)) continue
        const n = state(c, r, next)
        const g = cost[s]! + 1 + (next === dir ? 0 : turn)
        if (seen[n] === stamp && cost[n]! <= g) continue
        seen[n] = stamp
        cost[n] = g
        parent[n] = s
        heap.push(g + estimate(c, r), n)
      }
    }
    return null
  }
}

/** Drops the points in the middle of straight runs. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const [p, q] = [out[out.length - 2], out[out.length - 1]]
    if (q && q.x === point.x && q.y === point.y) continue
    if (p && q && ((p.x === q.x && q.x === point.x) || (p.y === q.y && q.y === point.y))) {
      out[out.length - 1] = point
    } else {
      out.push(point)
    }
  }
  return out
}

/** An SVG path through `points` with rounded corners. */
export function roundedPath(points: Point[], radius = 6): string {
  if (points.length === 0) return ''
  let d = `M${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, at, next] = [points[i - 1]!, points[i]!, points[i + 1]!]
    const before = Math.min(radius, Math.hypot(at.x - prev.x, at.y - prev.y) / 2)
    const after = Math.min(radius, Math.hypot(next.x - at.x, next.y - at.y) / 2)
    const toward = (from: Point, length: number) => {
      const d = Math.hypot(at.x - from.x, at.y - from.y) || 1
      return { x: at.x + ((from.x - at.x) / d) * length, y: at.y + ((from.y - at.y) / d) * length }
    }
    const [start, end] = [toward(prev, before), toward(next, after)]
    d += ` L${start.x} ${start.y} Q${at.x} ${at.y} ${end.x} ${end.y}`
  }
  const last = points[points.length - 1]!
  return `${d} L${last.x} ${last.y}`
}
