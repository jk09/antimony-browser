// Places the history map: groups as boxes packed in rows, the pages of a group in a grid inside
// its box. The order of the groups is chosen so that links between groups run through as few other
// groups as possible. Pure arithmetic, so the same input always gives the same picture and nothing
// overlaps.

export interface MapLayoutNode {
  id: number
  width: number
  height: number
}

export interface MapLayoutGroup {
  /** 0 for the pages that belong to no group. */
  id: number
  nodes: MapLayoutNode[]
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedGroup extends Box {
  id: number
}

/** Pages of group `a` led to pages of group `b` (or share keywords with them), `weight` times. */
export interface GroupLink {
  a: number
  b: number
  weight: number
}

export interface MapLayout {
  groups: PlacedGroup[]
  nodes: Map<number, Box>
  bounds: Box
}

export const GROUP_PAD = 12
export const GROUP_HEADER = 26
export const GROUP_GAP = 24
/** Space between pages; wide enough for an edge to pass between two of them. */
const NODE_GAP = 14

interface Sized {
  id: number
  width: number
  height: number
}

/** Shelf packing towards a landscape area, in the order given. */
function pack(boxes: Sized[]): Map<number, Box> {
  const area = boxes.reduce(
    (sum, box) => sum + (box.width + GROUP_GAP) * (box.height + GROUP_GAP),
    0,
  )
  const target = Math.max(...boxes.map((box) => box.width), Math.sqrt(area * 2.6))
  const placed = new Map<number, Box>()
  let x = 0
  let y = 0
  let shelf = 0
  for (const box of boxes) {
    if (x > 0 && x + box.width > target) {
      x = 0
      y += shelf + GROUP_GAP
      shelf = 0
    }
    placed.set(box.id, { x, y, width: box.width, height: box.height })
    x += box.width + GROUP_GAP
    shelf = Math.max(shelf, box.height)
  }
  return placed
}

const centreOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

/** Whether the segment from `p` to `q` passes through `box` (Liang–Barsky). */
export function crosses(
  p: { x: number; y: number },
  q: { x: number; y: number },
  box: Box,
): boolean {
  let [t0, t1] = [0, 1]
  const [dx, dy] = [q.x - p.x, q.y - p.y]
  const clip = (delta: number, distance: number) => {
    if (delta === 0) return distance >= 0
    const t = distance / delta
    if (delta < 0) {
      if (t > t1) return false
      t0 = Math.max(t0, t)
    } else {
      if (t < t0) return false
      t1 = Math.min(t1, t)
    }
    return true
  }
  return (
    clip(-dx, p.x - box.x) &&
    clip(dx, box.x + box.width - p.x) &&
    clip(-dy, p.y - box.y) &&
    clip(dy, box.y + box.height - p.y) &&
    t0 < t1
  )
}

/** How badly an arrangement draws the links: each other group a link runs through costs a lot. */
export function crossingScore(placed: Map<number, Box>, links: GroupLink[]): number {
  let score = 0
  for (const { a, b, weight } of links) {
    const [boxA, boxB] = [placed.get(a), placed.get(b)]
    if (!boxA || !boxB) continue
    const [p, q] = [centreOf(boxA), centreOf(boxB)]
    let through = 0
    for (const [id, box] of placed) if (id !== a && id !== b && crosses(p, q, box)) through++
    score += weight * (10 * through + Math.hypot(p.x - q.x, p.y - q.y) / 1000)
  }
  return score
}

/** Starts from the given order and swaps groups while that lowers the score; deterministic. */
function arrange(boxes: Sized[], links: GroupLink[]): Sized[] {
  let order = boxes
  if (links.length === 0 || boxes.length < 3) return order
  let best = crossingScore(pack(order), links)
  for (let pass = 0; pass < 6; pass++) {
    let improved = false
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order]
        ;[next[i], next[j]] = [next[j]!, next[i]!]
        const score = crossingScore(pack(next), links)
        if (score < best - 1e-9) {
          order = next
          best = score
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return order
}

/**
 * Lays out `groups` (largest first reads best); `links` say which groups are joined by edges, so
 * the groups can be ordered to keep those edges from running through other groups.
 */
export function layoutMap(groups: MapLayoutGroup[], links: GroupLink[] = []): MapLayout {
  const nodes = new Map<number, Box>()
  const boxes = groups
    .filter((group) => group.nodes.length > 0)
    .map((group) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.nodes.length)))
      const cellWidth = Math.max(...group.nodes.map((node) => node.width)) + NODE_GAP
      const cellHeight = Math.max(...group.nodes.map((node) => node.height)) + NODE_GAP
      const rows = Math.ceil(group.nodes.length / columns)
      return {
        group,
        id: group.id,
        columns,
        cellWidth,
        cellHeight,
        width: columns * cellWidth - NODE_GAP + 2 * GROUP_PAD,
        height: rows * cellHeight - NODE_GAP + 2 * GROUP_PAD + GROUP_HEADER,
      }
    })
  const ordered = arrange(boxes, links) as typeof boxes
  const frames = pack(ordered)
  const placed: PlacedGroup[] = []
  for (const box of ordered) {
    const frame = frames.get(box.id)!
    placed.push({ id: box.id, ...frame })
    box.group.nodes.forEach((node, index) => {
      const column = index % box.columns
      const row = Math.floor(index / box.columns)
      nodes.set(node.id, {
        x:
          frame.x +
          GROUP_PAD +
          column * box.cellWidth +
          (box.cellWidth - NODE_GAP - node.width) / 2,
        y: frame.y + GROUP_HEADER + GROUP_PAD + row * box.cellHeight,
        width: node.width,
        height: node.height,
      })
    })
  }
  const width = Math.max(0, ...placed.map((box) => box.x + box.width))
  const height = Math.max(0, ...placed.map((box) => box.y + box.height))
  return { groups: placed, nodes, bounds: { x: 0, y: 0, width, height } }
}
