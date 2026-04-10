/**
 * Strana jednotkového čtverce (1×1) v pixelech.
 * Strana x (x² a delší strana x×1) zvolena tak, aby NEBYLA celočíselný násobek UNIT_PX
 * (31 ≠ k·14), aby délka x nešla „složit“ z celých kopií strany 1.
 */
export const UNIT_PX = 28
/** 61 není násobek 28 (2·28=56, 3·28=84). */
export const X_PX = 61

/** Při tažení — přichytání k pixelové mřížce (x a 1 sdílejí společný „pixelový“ lattice). */
export const SNAP_PX = 1

/** Do kolika px od cizí hrany se dlaždice magneticky přitáhne (k sobě i k okraji plochy). */
export const MAGNET_SNAP_PX = 32

/** Další zarovnaná „=“ pod zadáním na plátně rovnice. */
export const EQUATION_EXTRA_EQUALS_ROWS = 4

/** Násobení mezi závorkami nebo mezi členem a závorkou — vždy mezera · mezera. */
export const MUL_DOT = ' \u00B7 '

/** Znak „–“ (U+2013) jako mínus ve výpisech a na klávesnici. */
export const TYPO_MINUS = '\u2013'

/** Před parsováním — všechny varianty mínusu na ASCII hyphen-minus. */
export const UNICODE_MINUS_LIKE_RE = /\u2212|\u2013|\u2012/g

/** Záporné číslo pro zobrazení (např. pravá strana rovnice) — stejný „–“ jako u výrazů. */
export function formatDisplayNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n < 0) return `${TYPO_MINUS}${String(Math.abs(n))}`
  return String(n)
}
