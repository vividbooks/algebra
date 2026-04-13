import type { PlacedTile } from './tiles'
import { tileFootprintForMode } from './tiles'

export type FreeSnapRect = { x: number; y: number; w: number; h: number }

/** Čára podél hrany jiné dlaždice (nebo okraje plátna), v souřadnicích vnitřního plátna. */
export type FreeEdgeSnapGuide =
  | { axis: 'x'; at: number; from: number; to: number }
  | { axis: 'y'; at: number; from: number; to: number }

const MIN_PARALLEL_OVERLAP = 3

function rectOf(tile: PlacedTile, x: number, y: number): FreeSnapRect {
  const { w, h } = tileFootprintForMode(tile.kind, tile.rot, 'freeGrid')
  return { x, y, w, h }
}

function yOverlap(a: FreeSnapRect, b: FreeSnapRect): number {
  return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
}

function xOverlap(a: FreeSnapRect, b: FreeSnapRect): number {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
}

function groupYSpan(moving: FreeSnapRect[]): { from: number; to: number } {
  let from = Infinity
  let to = -Infinity
  for (const r of moving) {
    from = Math.min(from, r.y)
    to = Math.max(to, r.y + r.h)
  }
  return { from, to }
}

function groupXSpan(moving: FreeSnapRect[]): { from: number; to: number } {
  let from = Infinity
  let to = -Infinity
  for (const r of moving) {
    from = Math.min(from, r.x)
    to = Math.max(to, r.x + r.w)
  }
  return { from, to }
}

/**
 * Jednotný posun skupiny tahajících se dlaždic tak, aby se hrany přichytily k ostatním / okrajům plátna.
 */
export function snapFreeMovingGroup(params: {
  staticTiles: PlacedTile[]
  moving: { tile: PlacedTile; x: number; y: number }[]
  innerW: number
  innerH: number
  threshold: number
}): { dx: number; dy: number; guides: FreeEdgeSnapGuide[] } {
  const { staticTiles, moving, innerW, innerH, threshold } = params
  if (moving.length === 0 || threshold <= 0) {
    return { dx: 0, dy: 0, guides: [] }
  }

  const staticRects = staticTiles.map((t) => rectOf(t, t.x, t.y))
  const movingRects = moving.map((m) => rectOf(m.tile, m.x, m.y))

  let bestDx = 0
  let bestAbsX = Infinity
  let gx: FreeEdgeSnapGuide | null = null

  let bestDy = 0
  let bestAbsY = Infinity
  let gy: FreeEdgeSnapGuide | null = null

  const considerX = (delta: number, guide: FreeEdgeSnapGuide) => {
    const ad = Math.abs(delta)
    if (ad > threshold) return
    if (ad < bestAbsX - 1e-6) {
      bestAbsX = ad
      bestDx = delta
      gx = guide
    }
  }

  const considerY = (delta: number, guide: FreeEdgeSnapGuide) => {
    const ad = Math.abs(delta)
    if (ad > threshold) return
    if (ad < bestAbsY - 1e-6) {
      bestAbsY = ad
      bestDy = delta
      gy = guide
    }
  }

  const yg = groupYSpan(movingRects)
  const xg = groupXSpan(movingRects)

  for (const M of movingRects) {
    for (const S of staticRects) {
      if (yOverlap(M, S) < MIN_PARALLEL_OVERLAP) continue

      const y0 = Math.max(M.y, S.y)
      const y1 = Math.min(M.y + M.h, S.y + S.h)

      considerX(S.x + S.w - M.x, { axis: 'x', at: S.x + S.w, from: y0, to: y1 })
      considerX(S.x - (M.x + M.w), { axis: 'x', at: S.x, from: y0, to: y1 })
      considerX(S.x - M.x, { axis: 'x', at: S.x, from: y0, to: y1 })
      considerX(S.x + S.w - (M.x + M.w), {
        axis: 'x',
        at: S.x + S.w,
        from: y0,
        to: y1,
      })
    }
  }

  for (const M of movingRects) {
    for (const S of staticRects) {
      if (xOverlap(M, S) < MIN_PARALLEL_OVERLAP) continue

      const x0 = Math.max(M.x, S.x)
      const x1 = Math.min(M.x + M.w, S.x + S.w)

      considerY(S.y + S.h - M.y, { axis: 'y', at: S.y + S.h, from: x0, to: x1 })
      considerY(S.y - (M.y + M.h), { axis: 'y', at: S.y, from: x0, to: x1 })
      considerY(S.y - M.y, { axis: 'y', at: S.y, from: x0, to: x1 })
      considerY(S.y + S.h - (M.y + M.h), {
        axis: 'y',
        at: S.y + S.h,
        from: x0,
        to: x1,
      })
    }
  }

  const minLX = Math.min(...movingRects.map((r) => r.x))
  const maxRX = Math.max(...movingRects.map((r) => r.x + r.w))
  const minTY = Math.min(...movingRects.map((r) => r.y))
  const maxBY = Math.max(...movingRects.map((r) => r.y + r.h))

  considerX(-minLX, { axis: 'x', at: 0, from: yg.from, to: yg.to })
  considerX(innerW - maxRX, { axis: 'x', at: innerW, from: yg.from, to: yg.to })
  considerY(-minTY, { axis: 'y', at: 0, from: xg.from, to: xg.to })
  considerY(innerH - maxBY, { axis: 'y', at: innerH, from: xg.from, to: xg.to })

  const guides: FreeEdgeSnapGuide[] = []
  if (gx) guides.push(gx)
  if (gy) guides.push(gy)
  return { dx: bestDx, dy: bestDy, guides }
}
