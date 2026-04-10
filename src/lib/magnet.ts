import { UNIT_PX, X_PX } from '../constants'
import { overlapsOthers, tileFootprint, type PlacedTile } from './tiles'

/** Dlaždice aspoň „jako x²“ na jedné straně — podél ní doplníme vodítě po UNIT_PX. */
const LARGE_EDGE = X_PX - 2

/** Všechna zarovnání levé / pravé hrany v prahu; seřazeno podle |pos − raw|. */
function axisSnapCandidates(
  raw: number,
  size: number,
  guides: Set<number>,
  threshold: number
): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  const push = (v: number) => {
    if (seen.has(v)) return
    seen.add(v)
    out.push(v)
  }
  push(raw)
  for (const g of guides) {
    if (Math.abs(g - raw) <= threshold) push(g)
    const rightAlign = g - size
    if (rightAlign >= 0 && Math.abs(rightAlign - raw) <= threshold) {
      push(rightAlign)
    }
  }
  out.sort(
    (a, b) =>
      Math.abs(a - raw) - Math.abs(b - raw) || Math.abs(a) - Math.abs(b)
  )
  return out
}

function buildGuides(others: PlacedTile[]): {
  vx: Set<number>
  hy: Set<number>
} {
  const vx = new Set<number>([0])
  const hy = new Set<number>([0])
  for (const t of others) {
    const { w: ow, h: oh } = tileFootprint(t.kind, t.rot)
    vx.add(t.x)
    vx.add(t.x + ow)
    hy.add(t.y)
    hy.add(t.y + oh)
    if (ow >= LARGE_EDGE) {
      for (let u = UNIT_PX; u < ow; u += UNIT_PX) vx.add(t.x + u)
    }
    if (oh >= LARGE_EDGE) {
      for (let u = UNIT_PX; u < oh; u += UNIT_PX) hy.add(t.y + u)
    }
  }
  return { vx, hy }
}

function fits(tile: PlacedTile, others: PlacedTile[]): boolean {
  return !overlapsOthers([...others, tile], tile)
}

/** Levé hrany ostatních dlaždic = sloupce; stejné x → přesně pod sebou. */
function columnLeftEdges(others: PlacedTile[]): Set<number> {
  const s = new Set<number>()
  for (const t of others) s.add(t.x)
  return s
}

/** Levá nebo pravá hrana dlaždice na svislé vodící čáře (žádná mezera vodorovně). */
function flushToVerticalGuides(
  x: number,
  w: number,
  vx: Set<number>
): boolean {
  return vx.has(x) || vx.has(x + w)
}

/** Horní nebo spodní hrana na vodorovné vodící čáře. */
function flushToHorizontalGuides(
  y: number,
  h: number,
  hy: Set<number>
): boolean {
  return hy.has(y) || hy.has(y + h)
}

function edgeFlushAxes(
  x: number,
  y: number,
  w: number,
  h: number,
  vx: Set<number>,
  hy: Set<number>
): number {
  return (
    (flushToVerticalGuides(x, w, vx) ? 1 : 0) +
    (flushToHorizontalGuides(y, h, hy) ? 1 : 0)
  )
}

/**
 * Přitáhne levý horní roh k nejbližším vodičům (hrany ostatních dlaždic, osa 0).
 * Zkouší kombinace os — plné přichycení nesmí vést k překryvu; jinak zkusí jen X / jen Y.
 */
export function magneticPosition(
  tile: PlacedTile,
  rawX: number,
  rawY: number,
  others: PlacedTile[],
  threshold: number
): { x: number; y: number } {
  const { w, h } = tileFootprint(tile.kind, tile.rot)
  const rawXc = Math.max(0, rawX)
  const rawYc = Math.max(0, rawY)

  const { vx, hy } = buildGuides(others)
  /** Alespoň šířka/výška x² — jinak často nestihneme na hranu (32 px nestačí k 61). */
  const snapReach = Math.max(threshold, X_PX)
  const cx = axisSnapCandidates(rawXc, w, vx, snapReach)
  const cy = axisSnapCandidates(rawYc, h, hy, snapReach)

  const pairs: { x: number; y: number; d: number }[] = []
  for (const x of cx) {
    for (const y of cy) {
      pairs.push({
        x,
        y,
        d: Math.abs(x - rawXc) + Math.abs(y - rawYc),
      })
    }
  }

  const columns = columnLeftEdges(others)
  /**
   * Sloupec (stejné x) jen když uživatel drží dlaždici horizon. blízko toho x.
   * Jinak silný bias vytáhne např. x vedle x² na (0, 61) pod místo na (61, y).
   */
  const COLUMN_BIAS = UNIT_PX
  /** Bonus za sloupec jen při táhnutí blízko toho x — jinak se nebrání vedle (x+61). */
  const COL_NEAR_PX = 12
  const alignsColumn = (x: number) =>
    columns.has(x) && Math.abs(x - rawXc) <= COL_NEAR_PX
  pairs.sort((a, b) => {
    /** Jinak vyhrá „raw“ kousek od hrany (x=65) — bez překryvu, ale se škvírou. */
    const fa = edgeFlushAxes(a.x, a.y, w, h, vx, hy)
    const fb = edgeFlushAxes(b.x, b.y, w, h, vx, hy)
    if (fb !== fa) return fb - fa
    const ac = alignsColumn(a.x)
    const bc = alignsColumn(b.x)
    const sa = a.d - (ac ? COLUMN_BIAS : 0)
    const sb = b.d - (bc ? COLUMN_BIAS : 0)
    if (sa !== sb) return sa - sb
    if (ac !== bc) return ac ? -1 : 1
    return a.d - b.d || a.x - b.x || a.y - b.y
  })

  for (const p of pairs) {
    const cand: PlacedTile = { ...tile, x: p.x, y: p.y }
    if (fits(cand, others)) return { x: p.x, y: p.y }
  }

  return { x: rawXc, y: rawYc }
}
