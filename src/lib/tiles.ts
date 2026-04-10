import { UNIT_PX, X_PX } from '../constants'
import type { PolyUpTo3 } from './parsePolyUpTo3'

export type TileKind = 'x2' | 'x1' | 'unit'

export interface PlacedTile {
  id: string
  kind: TileKind
  negative: boolean
  /** 0 = delší strana x vodorovně (šířka X_PX, výška UNIT_PX); 1 = obráceně */
  rot: 0 | 1
  /** Levý horní roh v pixelech na pracovní ploše */
  x: number
  y: number
}

export type BankKey = `${TileKind}_${'pos' | 'neg'}`

export function bankKey(kind: TileKind, negative: boolean): BankKey {
  return `${kind}_${negative ? 'neg' : 'pos'}`
}

export function parseBankKey(key: BankKey): { kind: TileKind; negative: boolean } {
  const [kind, sign] = key.split('_') as [TileKind, 'pos' | 'neg']
  return { kind, negative: sign === 'neg' }
}

/** Rozměry dlaždice v pixelech */
export function tileFootprint(
  kind: TileKind,
  rot: 0 | 1
): { w: number; h: number } {
  switch (kind) {
    case 'x2':
      return { w: X_PX, h: X_PX }
    case 'x1':
      return rot === 0
        ? { w: X_PX, h: UNIT_PX }
        : { w: UNIT_PX, h: X_PX }
    case 'unit':
      return { w: UNIT_PX, h: UNIT_PX }
  }
}

/** Pixely [x,y] uvnitř dlaždice (pro kontrolu překryvu a výplně). */
export function tileCells(tile: PlacedTile): [number, number][] {
  const { w, h } = tileFootprint(tile.kind, tile.rot)
  const out: [number, number][] = []
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      out.push([tile.x + dx, tile.y + dy])
    }
  }
  return out
}

export function cellsOverlap(a: PlacedTile[], skipId?: string): boolean {
  const seen = new Set<string>()
  for (const t of a) {
    if (t.id === skipId) continue
    for (const [cx, cy] of tileCells(t)) {
      const k = `${cx},${cy}`
      if (seen.has(k)) return true
      seen.add(k)
    }
  }
  return false
}

export function hasOverlap(tiles: PlacedTile[]): boolean {
  return cellsOverlap(tiles)
}

export function overlapsOthers(
  tiles: PlacedTile[],
  tile: PlacedTile
): boolean {
  const others = tiles.filter((t) => t.id !== tile.id)
  const mine = new Set(tileCells(tile).map(([x, y]) => `${x},${y}`))
  for (const t of others) {
    for (const [cx, cy] of tileCells(t)) {
      if (mine.has(`${cx},${cy}`)) return true
    }
  }
  return false
}

/**
 * Kladná + záporná stejného druhu se společným „pixelem“ (u x i shodná rotace) → nulový pár.
 */
export function tilesAreZeroPairOverlapping(a: PlacedTile, b: PlacedTile): boolean {
  if (a.id === b.id) return false
  if (a.kind !== b.kind || a.negative === b.negative) return false
  if (a.kind === 'x1' && a.rot !== b.rot) return false
  const cellsA = new Set(tileCells(a).map(([x, y]) => `${x},${y}`))
  for (const [x, y] of tileCells(b)) {
    if (cellsA.has(`${x},${y}`)) return true
  }
  return false
}

/**
 * Součet příspěvků dlaždic jako polynom v x (x², x, konstanta; x³ z dlaždic nejde).
 */
export function polynomialFromPlacedTiles(tiles: PlacedTile[]): PolyUpTo3 {
  let a3 = 0
  let a2 = 0
  let a1 = 0
  let a0 = 0
  for (const t of tiles) {
    const s = t.negative ? -1 : 1
    if (t.kind === 'x2') a2 += s
    else if (t.kind === 'x1') a1 += s
    else a0 += s
  }
  return { a3, a2, a1, a0 }
}
