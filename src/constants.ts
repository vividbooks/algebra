/**
 * Strana jednotkového čtverce (1×1) v pixelech.
 * Strana x (x² a delší strana x×1) zvolena tak, aby NEBYLA celočíselný násobek UNIT_PX,
 * aby délka x nešla „složit“ z celých kopií strany 1.
 */
export const UNIT_PX = 28
/** Delší strana x / strana x² v algebře — není celočíselný násobek UNIT_PX (2·28=56, 3·28=84). */
export const X_PX = 51

/**
 * Rámeček dlaždice (styl PT) — inset obrys a posun spodní podložky jsou všude stejné (px),
 * aby u větších dlaždic nepůsobily „silnější“ než u jednotky.
 */
export const ALGEBRA_TILE_FRAME_INSET_STROKE_PX = 3.5
export const ALGEBRA_TILE_FRAME_UNDERLAY_SHIFT_PX = 3

/** Volné plátno — krok mřížky v logických px (náhled při pokládání / rovnice). */
export const FREE_GRID_CELL_PX = 50

/**
 * Kratší strana obdélníku „x“ na volném plátně a zároveň strana čtverce „1“.
 */
export const FREE_GRID_X1_SHORT_PX = 34

/**
 * Delší strana x a strana čtverce x² na volném plátně — mírně kratší než 2× buňka mřížky.
 */
export const FREE_GRID_X_LONG_PX = 2 * FREE_GRID_CELL_PX - 10

/**
 * Delší strana náhledu dlaždice ve spodní liště (px). Poměry stran = jako na plátně (tileFootprintFreeGrid).
 */
export const FREE_BANK_PREVIEW_MAX_SIDE_PX = 72

/** Přichycení hran při tažení na volném plátně — tolerance na obrazovce (px); ve vnitřních souřadnicích se dělí zoomem. */
export const FREE_EDGE_SNAP_SCREEN_PX = 10

/**
 * Logická rezerva šířky/výšky světa nad rámec dlaždic — kam až jde posouvat (figmovské „nekonečné“ plátno).
 */
export const FREE_CANVAS_PAN_ROOM_PX = 3200

/** Volné plátno — meze měřítka (slider, kolečko, tlačítka). Užší rozsah než dřív (bez extrémního in/out). */
export const FREE_ZOOM_MIN = 0.55
export const FREE_ZOOM_MAX = 1.85

/** Výchozí zoom = střed posuvníku (mezi FREE_ZOOM_MIN a FREE_ZOOM_MAX). */
export const FREE_ZOOM_DEFAULT = (FREE_ZOOM_MIN + FREE_ZOOM_MAX) / 2

export function clampFreeZoom(z: number): number {
  if (!Number.isFinite(z)) return FREE_ZOOM_DEFAULT
  return Math.min(FREE_ZOOM_MAX, Math.max(FREE_ZOOM_MIN, z))
}

/**
 * Přepočet wheel delta z řádků/stránek na „pixelové“ jednotky (konzistentní citlivost mezi prohlížeči).
 */
export function freeWheelNormalizeDelta(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>): {
  x: number
  y: number
} {
  let x = e.deltaX
  let y = e.deltaY
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    x *= 32
    y *= 32
  } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    x *= 600
    y *= 600
  }
  return { x, y }
}

/**
 * Pinch / Ctrl+kolečko: z' = z × exp(−normované deltaY × tento faktor).
 * Vyšší = citlivější (trackpad posílá malá delta po jednom).
 */
export const FREE_WHEEL_ZOOM_EXP_SENSITIVITY = 0.032

/** Omezí |deltaY| na jednu wheel událost (po normalizaci), aby jeden „šťouchnutí“ neskočilo na MIN/MAX. */
export const FREE_WHEEL_ZOOM_DELTA_CAP = 140

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
