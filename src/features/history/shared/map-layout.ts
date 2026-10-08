// Places the history map: groups as boxes packed in rows, the pages of a group in a grid inside
// its box. Pure arithmetic, so the same input always gives the same picture and nothing overlaps.

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

export interface MapLayout {
  groups: PlacedGroup[]
  nodes: Map<number, Box>
  bounds: Box
}

export const GROUP_PAD = 12
export const GROUP_HEADER = 26
export const GROUP_GAP = 24
const NODE_GAP = 10

/** Lays out `groups` in the order given (largest first reads best). */
export function layoutMap(groups: MapLayoutGroup[]): MapLayout {
  const nodes = new Map<number, Box>()
  const boxes = groups
    .filter((group) => group.nodes.length > 0)
    .map((group) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.nodes.length * 1.6)))
      const cellWidth = Math.max(...group.nodes.map((node) => node.width)) + NODE_GAP
      const cellHeight = Math.max(...group.nodes.map((node) => node.height)) + NODE_GAP
      const rows = Math.ceil(group.nodes.length / columns)
      return {
        group,
        columns,
        cellWidth,
        cellHeight,
        width: columns * cellWidth - NODE_GAP + 2 * GROUP_PAD,
        height: rows * cellHeight - NODE_GAP + 2 * GROUP_PAD + GROUP_HEADER,
      }
    })

  // Shelf packing towards a landscape area.
  const area = boxes.reduce(
    (sum, box) => sum + (box.width + GROUP_GAP) * (box.height + GROUP_GAP),
    0,
  )
  const target = Math.max(...boxes.map((box) => box.width), Math.sqrt(area * 1.6))
  const placed: PlacedGroup[] = []
  let x = 0
  let y = 0
  let shelf = 0
  for (const box of boxes) {
    if (x > 0 && x + box.width > target) {
      x = 0
      y += shelf + GROUP_GAP
      shelf = 0
    }
    placed.push({ id: box.group.id, x, y, width: box.width, height: box.height })
    box.group.nodes.forEach((node, index) => {
      const column = index % box.columns
      const row = Math.floor(index / box.columns)
      nodes.set(node.id, {
        x: x + GROUP_PAD + column * box.cellWidth + (box.cellWidth - NODE_GAP - node.width) / 2,
        y: y + GROUP_HEADER + GROUP_PAD + row * box.cellHeight,
        width: node.width,
        height: node.height,
      })
    })
    x += box.width + GROUP_GAP
    shelf = Math.max(shelf, box.height)
  }
  const width = Math.max(0, ...placed.map((box) => box.x + box.width))
  const height = Math.max(0, ...placed.map((box) => box.y + box.height))
  return { groups: placed, nodes, bounds: { x: 0, y: 0, width, height } }
}
