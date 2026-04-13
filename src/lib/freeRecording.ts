import { FREE_GRID_CELL_PX } from '../constants'
import { formatPolyUpTo3Expr } from './parsePolyUpTo3'
import {
  partitionTilesByEqualsColumn,
  polynomialFromPlacedTiles,
  type PlacedTile,
} from './tiles'

/** Typy akcí na volném plátně (analogicky k FreeGeometryEditor). */
export type FreeRecordingActionType =
  | 'place'
  | 'remove'
  | 'zero-pair'
  | 'move'
  | 'flip'
  | 'rotate'
  | 'duplicate-group'
  | 'clear'
  | 'multi'
  | 'other'

export type FreeRecordingStep = {
  id: string
  actionType: FreeRecordingActionType
  description: string
  /** Matematický zápis stavu plochy (jako spodní lišta); lze upravit v editoru kroků. */
  notation?: string
  snapshot: PlacedTile[]
}

export function clonePlacedTilesList(tiles: PlacedTile[]): PlacedTile[] {
  return tiles.map((t) => ({ ...t }))
}

/**
 * Stejný textový zápis jako u spodního proužku na volném plátně (součet nebo LHS = RHS).
 */
export function freeCanvasMathNotation(
  tiles: PlacedTile[],
  opts: { equalsMode: boolean; eqBandLeft: number }
): string {
  if (opts.equalsMode) {
    const { left, right } = partitionTilesByEqualsColumn(
      tiles,
      opts.eqBandLeft,
      FREE_GRID_CELL_PX,
      'freeGrid'
    )
    const lhs = formatPolyUpTo3Expr(polynomialFromPlacedTiles(left))
    const rhs = formatPolyUpTo3Expr(polynomialFromPlacedTiles(right))
    return `${lhs} = ${rhs}`
  }
  return formatPolyUpTo3Expr(polynomialFromPlacedTiles(tiles))
}

function byId(a: PlacedTile, b: PlacedTile): number {
  return a.id.localeCompare(b.id)
}

export function tilesDeepEqual(a: PlacedTile[], b: PlacedTile[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort(byId)
  const sb = [...b].sort(byId)
  for (let i = 0; i < sa.length; i++) {
    const u = sa[i]
    const v = sb[i]
    if (
      u.id !== v.id ||
      u.kind !== v.kind ||
      u.negative !== v.negative ||
      u.rot !== v.rot ||
      u.x !== v.x ||
      u.y !== v.y
    ) {
      return false
    }
  }
  return true
}

/**
 * Rozdíl mezi dvěma snímky plochy — pro automatické nahrávání (debounce jako v geometry app).
 */
export function describeTilesRecordingStep(
  prev: PlacedTile[],
  cur: PlacedTile[]
): { description: string; actionType: FreeRecordingActionType } | null {
  if (tilesDeepEqual(prev, cur)) return null

  const prevById = new Map(prev.map((t) => [t.id, t]))
  const curById = new Map(cur.map((t) => [t.id, t]))
  const prevIds = new Set(prev.map((t) => t.id))
  const curIds = new Set(cur.map((t) => t.id))
  const added = [...curIds].filter((id) => !prevIds.has(id))
  const removed = [...prevIds].filter((id) => !curIds.has(id))

  if (added.length === 0 && removed.length === 0) {
    const changed: PlacedTile[] = []
    for (const id of curIds) {
      const p = prevById.get(id)!
      const c = curById.get(id)!
      if (
        p.x !== c.x ||
        p.y !== c.y ||
        p.negative !== c.negative ||
        p.rot !== c.rot ||
        p.kind !== c.kind
      ) {
        changed.push(c)
      }
    }
    if (changed.length === 0) return null
    if (changed.length === 1) {
      const c = changed[0]
      const p = prevById.get(c.id)!
      if (p.x !== c.x || p.y !== c.y) {
        return { description: 'Přesunutí dlaždice', actionType: 'move' }
      }
      if (p.negative !== c.negative) {
        return { description: 'Přepnutí znaménka dlaždice', actionType: 'flip' }
      }
      if (p.rot !== c.rot) {
        return { description: 'Otočení dlaždice (x)', actionType: 'rotate' }
      }
    }
    return {
      description: `Úprava ${changed.length} dlaždic`,
      actionType: 'multi',
    }
  }

  if (removed.length === 0 && added.length >= 1) {
    if (added.length === 1) {
      return { description: 'Přidání dlaždice na plochu', actionType: 'place' }
    }
    return {
      description: `Přidání ${added.length} dlaždic`,
      actionType: added.length > 1 ? 'duplicate-group' : 'place',
    }
  }

  if (added.length === 0 && removed.length >= 1) {
    if (prev.length > 0 && cur.length === 0) {
      return { description: 'Vyčištění plochy', actionType: 'clear' }
    }
    if (removed.length === 1) {
      return {
        description: 'Odebrání dlaždice z plochy',
        actionType: 'remove',
      }
    }
    if (removed.length === 2 && added.length === 0) {
      return {
        description: 'Odstranění nulového páru',
        actionType: 'zero-pair',
      }
    }
    return {
      description: `Odebrání ${removed.length} dlaždic`,
      actionType: 'multi',
    }
  }

  return { description: 'Změna rozložení dlaždic', actionType: 'other' }
}
