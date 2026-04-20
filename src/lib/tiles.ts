import {
  FREE_GRID_X1_SHORT_PX,
  FREE_GRID_X_LONG_PX,
  TYPO_MINUS,
  UNIT_PX,
  X_PX,
} from '../constants'
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

/** Režim geometrie: klasická algebra vs. násobky mřížky na volném plátně (FREE_GRID_CELL_PX). */
export type TileGeomMode = 'algebra' | 'freeGrid'

/** Strana zdrojové dlaždice, kam umístit kopii (+ v kolečku). */
export type DuplicateFromSide = 'left' | 'right' | 'bottom'

/** x² = čtverec FREE_GRID_X_LONG_PX, x = tento bok × krátká strana, jednotka = čtverec krátké strany. */
export function tileFootprintFreeGrid(
  kind: TileKind,
  rot: 0 | 1
): { w: number; h: number } {
  const xLong = FREE_GRID_X_LONG_PX
  const xShort = FREE_GRID_X1_SHORT_PX
  switch (kind) {
    case 'x2':
      return { w: xLong, h: xLong }
    case 'x1':
      return rot === 0
        ? { w: xLong, h: xShort }
        : { w: xShort, h: xLong }
    case 'unit':
      return { w: xShort, h: xShort }
  }
}

export function tileFootprintForMode(
  kind: TileKind,
  rot: 0 | 1,
  mode: TileGeomMode
): { w: number; h: number } {
  return mode === 'freeGrid'
    ? tileFootprintFreeGrid(kind, rot)
    : tileFootprint(kind, rot)
}

/** Osy rovnoběžné obdélníky (levý horní roh + rozměry z `tileFootprintForMode`). */
export function tileRectsOverlap(
  a: PlacedTile,
  b: PlacedTile,
  mode: TileGeomMode
): boolean {
  const fa = tileFootprintForMode(a.kind, a.rot, mode)
  const fb = tileFootprintForMode(b.kind, b.rot, mode)
  return (
    a.x < b.x + fb.w &&
    b.x < a.x + fa.w &&
    a.y < b.y + fb.h &&
    b.y < a.y + fa.h
  )
}

const EDGE_ALIGN_EPS = 0.5

function segmentOverlap1D(
  a0: number,
  a1: number,
  b0: number,
  b1: number
): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

/** Kde smí být tlačítko kopírování (+ v kolečku): strana je volná, pokud na ni přímo nenavazuje jiná dlaždice. */
export type DuplicateEdgeFlags = {
  left: boolean
  right: boolean
  bottom: boolean
}

export function duplicateEdgesFree(
  tile: PlacedTile,
  allTiles: PlacedTile[],
  mode: TileGeomMode
): DuplicateEdgeFlags {
  const { w: tw, h: th } = tileFootprintForMode(tile.kind, tile.rot, mode)
  const tx = tile.x
  const ty = tile.y
  const tr = tx + tw
  const tb = ty + th

  let leftBlocked = false
  let rightBlocked = false
  let bottomBlocked = false

  for (const o of allTiles) {
    if (o.id === tile.id) continue
    const { w: ow, h: oh } = tileFootprintForMode(o.kind, o.rot, mode)
    const ox = o.x
    const oy = o.y
    const or = ox + ow
    const ob = oy + oh

    const yOv = segmentOverlap1D(ty, tb, oy, ob)
    if (yOv > EDGE_ALIGN_EPS) {
      if (Math.abs(or - tx) < EDGE_ALIGN_EPS) leftBlocked = true
      if (Math.abs(ox - tr) < EDGE_ALIGN_EPS) rightBlocked = true
    }

    const xOv = segmentOverlap1D(tx, tr, ox, or)
    if (xOv > EDGE_ALIGN_EPS) {
      if (Math.abs(oy - tb) < EDGE_ALIGN_EPS) bottomBlocked = true
    }
  }

  return {
    left: !leftBlocked,
    right: !rightBlocked,
    bottom: !bottomBlocked,
  }
}

export function cellsOverlap(
  a: PlacedTile[],
  skipId?: string,
  mode: TileGeomMode = 'algebra'
): boolean {
  const list = skipId ? a.filter((t) => t.id !== skipId) : a
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (tileRectsOverlap(list[i]!, list[j]!, mode)) return true
    }
  }
  return false
}

export function hasOverlap(
  tiles: PlacedTile[],
  mode: TileGeomMode = 'algebra'
): boolean {
  return cellsOverlap(tiles, undefined, mode)
}

export function overlapsOthers(
  tiles: PlacedTile[],
  tile: PlacedTile,
  mode: TileGeomMode = 'algebra'
): boolean {
  const others = tiles.filter((t) => t.id !== tile.id)
  for (const t of others) {
    if (tileRectsOverlap(tile, t, mode)) return true
  }
  return false
}

/**
 * Kladná + záporná stejného druhu s neprázdným průnikem ploch (u x i shodná rotace) → nulový pár.
 */
export function tilesAreZeroPairOverlapping(
  a: PlacedTile,
  b: PlacedTile,
  mode: TileGeomMode = 'algebra'
): boolean {
  if (a.id === b.id) return false
  if (a.kind !== b.kind || a.negative === b.negative) return false
  if (a.kind === 'x1' && a.rot !== b.rot) return false
  return tileRectsOverlap(a, b, mode)
}

/** Odstraní všechny nulové páry z plochy, dokud žádný nezbývá. */
export function eliminateAllZeroPairs(
  tiles: PlacedTile[],
  mode: TileGeomMode
): PlacedTile[] {
  let cur = tiles
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        if (tilesAreZeroPairOverlapping(cur[i], cur[j], mode)) {
          const a = cur[i].id
          const b = cur[j].id
          cur = cur.filter((t) => t.id !== a && t.id !== b)
          changed = true
          break outer
        }
      }
    }
  }
  return cur
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

/**
 * Zápis podle skutečných dlaždic — každá dlaždice je vlastní člen, bez slučování
 * (např. x + x + 1 + 1 místo 2x + 2). Pořadí: shora dolů, zleva doprava.
 */
export function formatPlacedTilesAsSum(tiles: PlacedTile[]): string {
  if (tiles.length === 0) return '0'
  const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x)
  let s = ''
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]
    const body = t.kind === 'x2' ? 'x²' : t.kind === 'x1' ? 'x' : '1'
    if (i === 0) {
      s = t.negative ? `${TYPO_MINUS} ${body}` : body
    } else {
      s += t.negative ? ` ${TYPO_MINUS} ${body}` : ` + ${body}`
    }
  }
  return s
}

/**
 * Rozdělí dlaždice podle svislého pásu rovnítka: levý okraj pásu `eqBandLeft`, šířka buňky `cellPx`.
 * Střed pásu je „čára“; dlaždice podle středu své šířky (x + w/2) vlevo nebo vpravo.
 */
export function partitionTilesByEqualsColumn(
  tiles: PlacedTile[],
  eqBandLeft: number,
  cellPx: number,
  mode: TileGeomMode
): { left: PlacedTile[]; right: PlacedTile[] } {
  const mid = eqBandLeft + cellPx / 2
  const left: PlacedTile[] = []
  const right: PlacedTile[] = []
  for (const t of tiles) {
    const { w } = tileFootprintForMode(t.kind, t.rot, mode)
    const cx = t.x + w / 2
    if (cx < mid) left.push(t)
    else right.push(t)
  }
  left.sort((a, b) => a.y - b.y || a.x - b.x)
  right.sort((a, b) => a.y - b.y || a.x - b.x)
  return { left, right }
}
