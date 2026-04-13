import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ALGEBRA_TILE_FRAME_UNDERLAY_SHIFT_PX,
  EQUATION_EXTRA_EQUALS_ROWS,
  FREE_BANK_PREVIEW_MAX_SIDE_PX,
  FREE_GRID_CELL_PX,
  clampFreeZoom,
  MAGNET_SNAP_PX,
  MUL_DOT,
  SNAP_PX,
  TYPO_MINUS,
  UNICODE_MINUS_LIKE_RE,
  X_PX,
} from './constants'
import { TileView } from './components/TileView'
import {
  bankKey,
  partitionTilesByEqualsColumn,
  hasOverlap,
  tilesAreZeroPairOverlapping,
  eliminateAllZeroPairs,
  polynomialFromPlacedTiles,
  overlapsOthers,
  parseBankKey,
  tileFootprintForMode,
  tileFootprintFreeGrid,
  type BankKey,
  type PlacedTile,
  type TileGeomMode,
  type TileKind,
} from './lib/tiles'
import { magneticPosition } from './lib/magnet'
import { MathKeyboard } from './components/MathKeyboard'
import { MergedColoredPolyExpr } from './components/MergedColoredPolyExpr'
import { MathText } from './components/MathText'
import { parseLinearBinomial } from './lib/parseLinearBinomial'
import {
  formatPolyUpTo3Expr,
  parsePolynomialUpTo3,
  polyUpTo3Equal,
} from './lib/parsePolyUpTo3'
import { parseQuadratic, quadraticsEqual } from './lib/parseQuadratic'
import {
  formatPolynomial,
  generateFactorTask,
  matchesFactorization,
  type FactorLevel,
  type FactorTask,
} from './tasks'
import {
  generateSimplifyTask,
  type SimplifyLevel,
  type SimplifyTask,
} from './simplify'
import {
  equationScaffoldSides,
  equationSolutionX,
  generateEquationTask,
  type EquationLevel,
  type EquationTask,
} from './linearEquation'
import {
  generateExpandTask,
  type ExpandKind,
  type ExpandLevel,
  type ExpandTask,
} from './expand'
import {
  FreeCanvasNotesPanel,
  FreeCanvasRightBar,
  FreeCanvasTopBar,
  type FreeSessionLogEntry,
} from './components/freeCanvas/FreeCanvasChrome'
import {
  FreeRecordingPlayer,
  FreeRecordingStepEditor,
} from './components/freeCanvas/FreeRecordingModals'
import {
  clonePlacedTilesList,
  describeTilesRecordingStep,
  freeCanvasMathNotation,
  type FreeRecordingStep,
} from './lib/freeRecording'
import { Hand, Minus, MousePointer2, Plus, Trash2 } from 'lucide-react'

const FREE_NOTES_STORAGE_KEY = 'algebra-tiles-free-notes-v1'

type AppRoute =
  | 'menu'
  | 'factor'
  | 'simplify'
  | 'equation'
  | 'expand'
  | 'free'

/** Název režimu v hlavním nadpisu cvičení: „Algebraické dlaždice – …“. */
const APP_MODE_HEADING: Record<Exclude<AppRoute, 'menu'>, string> = {
  factor: 'Rozklad na součin',
  simplify: 'Zjednodušování',
  equation: 'Rovnice',
  expand: 'Roznásobování',
  free: 'Volné plátno',
}

type DragTile = {
  kind: 'tile'
  id: string
  startPx: number
  startPy: number
  /** Počáteční pozice všech dlaždic ve skupině (včetně `id`). */
  memberOrigins: Record<string, { gx: number; gy: number }>
  /** Úchop oproti levému hornímu rohu dlaždice (viewport). */
  grabOffX: number
  grabOffY: number
}

type DragFromBank = {
  kind: 'fromBank'
  key: BankKey
  w: number
  h: number
  /** Úchop v pixelech od levého horního rohu náhledu ve zásobníku. */
  grabOffX: number
  grabOffY: number
}

type DragMode = DragTile | DragFromBank | null

const BOARD_PAD_PX = 24

const FREE_BANK_CHROME_SEL =
  '.bank-sidebar--free-tools .bank-rail__back, .bank-sidebar--free-tools .bank-rail__tool, .bank-sidebar--free-tools .bank-cell, .bank-sidebar--free-tools .bank-rail__clear'

/** Měřítko náhledu vůči plátnu: max strana = FREE_BANK_PREVIEW_MAX_SIDE_PX (x² má stranu 2·G). */
const FREE_BANK_RAIL_SCALE =
  FREE_BANK_PREVIEW_MAX_SIDE_PX / (2 * FREE_GRID_CELL_PX)

const SOURCE_META: { kind: TileKind; negative: boolean; caption: string }[] =
  [
    { kind: 'x2', negative: false, caption: 'x²' },
    { kind: 'x1', negative: false, caption: 'x' },
    { kind: 'unit', negative: false, caption: '1' },
    { kind: 'x2', negative: true, caption: `${TYPO_MINUS}x²` },
    { kind: 'x1', negative: true, caption: `${TYPO_MINUS}x` },
    { kind: 'unit', negative: true, caption: `${TYPO_MINUS}1` },
  ]

function resizeToFitTiles(
  tiles: PlacedTile[],
  geom: TileGeomMode
): { gw: number; gh: number } {
  const baseMin =
    geom === 'freeGrid'
      ? FREE_GRID_CELL_PX * 8 + BOARD_PAD_PX
      : X_PX * 3 + BOARD_PAD_PX
  let maxR = baseMin
  let maxB = baseMin
  for (const t of tiles) {
    const { w, h } = tileFootprintForMode(t.kind, t.rot, geom)
    maxR = Math.max(maxR, t.x + w + BOARD_PAD_PX)
    maxB = Math.max(maxB, t.y + h + BOARD_PAD_PX)
  }
  return { gw: maxR, gh: maxB }
}

function snapCoord(v: number): number {
  return Math.round(v / SNAP_PX) * SNAP_PX
}

/** Levá / pravá strana rovnice podle středu dlaždice — jako `partitionTilesByEqualsColumn`. */
function freeTileEquationSide(
  x: number,
  kind: TileKind,
  rot: 0 | 1,
  eqBandLeft: number
): 'left' | 'right' {
  const { w } = tileFootprintForMode(kind, rot, 'freeGrid')
  const mid = eqBandLeft + FREE_GRID_CELL_PX / 2
  return x + w / 2 < mid ? 'left' : 'right'
}

const LASSO_MIN_DRAG_PX = 8

function tryPlaceDuplicate(
  source: PlacedTile,
  all: PlacedTile[],
  isFree: boolean
): PlacedTile | null {
  const geom: TileGeomMode = isFree ? 'freeGrid' : 'algebra'
  const G = FREE_GRID_CELL_PX
  const { w, h } = tileFootprintForMode(source.kind, source.rot, geom)
  const rawCandidates: [number, number][] = []
  const x0 = source.x
  const y0 = source.y
  for (let dy = 1; dy <= 28; dy++) rawCandidates.push([x0, y0 + dy * h])
  for (let dx = 1; dx <= 28; dx++) {
    rawCandidates.push([x0 + dx * w, y0])
    rawCandidates.push([x0 - dx * w, y0])
  }
  const tryAt = (rawX: number, rawY: number, useMagnet: boolean): PlacedTile | null => {
    const xClamped = isFree
      ? Math.max(0, Math.round(rawX / G) * G)
      : Math.max(0, snapCoord(rawX))
    const yClamped = isFree
      ? Math.max(0, Math.round(rawY / G) * G)
      : Math.max(0, snapCoord(rawY))
    let draft: PlacedTile = {
      ...source,
      id: crypto.randomUUID(),
      x: xClamped,
      y: yClamped,
    }
    if (!isFree && useMagnet) {
      const m = magneticPosition(
        draft,
        xClamped,
        yClamped,
        all,
        MAGNET_SNAP_PX
      )
      draft = { ...draft, x: m.x, y: m.y }
    }
    if (all.some((o) => tilesAreZeroPairOverlapping(draft, o, geom))) {
      return null
    }
    const next = [...all, draft]
    if (!hasOverlap(next, geom)) return draft
    return null
  }
  for (const [rx, ry] of rawCandidates) {
    const d = tryAt(rx, ry, true)
    if (d) return d
  }
  for (const [rx, ry] of rawCandidates) {
    const d = tryAt(rx, ry, false)
    if (d) return d
  }
  return null
}

function tileIntersectsLassoRect(
  t: PlacedTile,
  geom: TileGeomMode,
  left: number,
  top: number,
  right: number,
  bottom: number
): boolean {
  const { w, h } = tileFootprintForMode(t.kind, t.rot, geom)
  const tl = t.x
  const tt = t.y
  const tr = t.x + w
  const tb = t.y + h
  return !(tr < left || tl > right || tb < top || tt > bottom)
}

function applyGroupFlip(
  prev: PlacedTile[],
  groupIds: string[],
  isFree: boolean
): { next: PlacedTile[]; selectionIds: string[] } {
  const geom: TileGeomMode = isFree ? 'freeGrid' : 'algebra'
  let cur = prev
  const keepSelected = new Set(groupIds)
  for (const id of groupIds) {
    if (!keepSelected.has(id)) continue
    const t = cur.find((x) => x.id === id)
    if (!t) {
      keepSelected.delete(id)
      continue
    }
    const flipped: PlacedTile = { ...t, negative: !t.negative }
    const others = cur.filter((x) => x.id !== id)
    const pair = others.find((o) =>
      tilesAreZeroPairOverlapping(flipped, o, geom)
    )
    if (pair) {
      cur = cur.filter((p) => p.id !== id && p.id !== pair.id)
      keepSelected.delete(id)
      keepSelected.delete(pair.id)
      continue
    }
    if (isFree) {
      const adjusted: PlacedTile = { ...flipped }
      if (overlapsOthers([...others, adjusted], adjusted, 'freeGrid')) continue
      cur = cur.map((p) => (p.id === id ? adjusted : p))
    } else {
      const { x, y } = magneticPosition(
        flipped,
        flipped.x,
        flipped.y,
        others,
        MAGNET_SNAP_PX
      )
      const adjusted: PlacedTile = { ...flipped, x, y }
      if (overlapsOthers([...others, adjusted], adjusted)) continue
      cur = cur.map((p) => (p.id === id ? adjusted : p))
    }
  }
  const selectionIds = [...keepSelected].filter((i) =>
    cur.some((t) => t.id === i)
  )
  return { next: cur, selectionIds }
}

const FREE_TILE_HISTORY_LIMIT = 100

function tilesStateEqual(a: PlacedTile[], b: PlacedTile[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const u = a[i]
    const v = b[i]
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
 * Levý horní roh dlaždice přichycený k mřížce volného plátna (50px).
 * Měřítko bere z poměru CSS rozměru vnitřku (innerW/H) k getBoundingClientRect()
 * (po transform: scale), ne z oddělené proměnné zoom — jinak při nesouladu vznikne
 * „jen levá třetina plátna“ pro pokládání.
 */
function freeInnerPointerToGridTopLeft(
  clientX: number,
  clientY: number,
  tileW: number,
  tileH: number,
  innerRect: DOMRect,
  innerCssW: number,
  innerCssH: number
): { x: number; y: number } {
  const G = FREE_GRID_CELL_PX
  const rw = Math.max(1e-6, innerRect.width)
  const rh = Math.max(1e-6, innerRect.height)
  const sx = innerCssW / rw
  const sy = innerCssH / rh
  const px = (clientX - innerRect.left) * sx - tileW / 2
  const py = (clientY - innerRect.top) * sy - tileH / 2
  return {
    x: Math.max(0, Math.round(px / G) * G),
    y: Math.max(0, Math.round(py / G) * G),
  }
}

function freeInnerGridHighlightSize(tileW: number, tileH: number) {
  const G = FREE_GRID_CELL_PX
  return {
    w: Math.max(G, Math.ceil(tileW / G) * G),
    h: Math.max(G, Math.ceil(tileH / G) * G),
  }
}

/** Hodnoty ze vstupů – trim, Unicode minus, desetinná čárka. */
function parseFactorNumber(raw: string): number {
  const t = raw
    .trim()
    .replace(UNICODE_MINUS_LIKE_RE, '-')
    .replace(/\u00B7/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
  return Number(t)
}

function ControlsHelpPanel({ route }: { route: AppRoute }) {
  const commonTiles = (
    <>
      <h3 className="controls-help__h">Dlaždice a plocha</h3>
      <ul className="controls-help__list">
        <li>Přetáhněte dlaždici ze zásobníku vlevo na šedou pracovní plochu.</li>
        <li>
          Dlaždici na ploše přesuňte přetažením. Vrátíte ji do zásobníku tak, že ji přetáhnete
          nad levý panel a pustíte tam.
        </li>
        <li>Kliknutím dlaždici vyberete (modrý obrys).</li>
        <li>
          Pravým tlačítkem přepínáte znaménko. Překryjí-li se kladná a záporná stejného tvaru
          ve stejném místě, vznikne nulový pár a dlaždice zmizí.
        </li>
        <li>
          <strong>Dvojklik</strong> na dlaždici <MathText text="x" /> otočí její orientaci.
        </li>
        <li>Při přetahování se dlaždice přichytávají k hranám ostatních a k okrajům plochy.</li>
        <li>
          <strong>Vyčistit plochu a vstupy</strong> v levém panelu smaže dlaždice i textové odpovědi
          k aktuální úloze.
        </li>
      </ul>
    </>
  )

  const wrap = (children: ReactNode) => (
    <div
      className="controls-help-panel"
      id="controls-help-panel"
      role="region"
      aria-label="Nápověda k ovládání"
    >
      {children}
    </div>
  )

  switch (route) {
    case 'menu':
      return wrap(
        <>
          <p className="controls-help__lead">
            Vyberte režim níže. Po vstupu do cvičení otevřete nápovědu znovu v horní liště u
            názvu aplikace.
          </p>
          {commonTiles}
        </>
      )
    case 'factor':
      return wrap(
        <>
          {commonTiles}
          <h3 className="controls-help__h">Rozklad na součin</h3>
          <ul className="controls-help__list">
            <li>
              Dva činitelé zapisujte do polí v závorkách. Matematická klávesnice pod úlohou
              píše do pole, ve kterém je kurzor (klepněte do pole).
            </li>
            <li>
              <strong>Zkontrolovat rozklad</strong> ověří součin činitelů vůči zobrazenému
              trojčlenu.
            </li>
            <li>
              <strong>Zkontrolovat dlaždice</strong> porovná součet dlaždic na ploše s polynomem
              úlohy.
            </li>
          </ul>
        </>
      )
    case 'simplify':
      return wrap(
        <>
          {commonTiles}
          <h3 className="controls-help__h">Zjednodušování</h3>
          <ul className="controls-help__list">
            <li>Výsledek zapište za rovnítko; klávesnice doplňuje textový vstup.</li>
            <li>
              <strong>Zkontrolovat zjednodušování</strong> porovná váš polynom s očekávaným.
            </li>
          </ul>
        </>
      )
    case 'equation':
      return wrap(
        <>
          {commonTiles}
          <h3 className="controls-help__h">Rovnice</h3>
          <ul className="controls-help__list">
            <li>
              Rovnice je naznačena uprostřed plochy; modelujte ji dlaždicemi podle potřeby.
            </li>
            <li>
              Hodnotu <MathText text="x" /> zapište do pole nad plochou.
            </li>
            <li>
              <strong>Zkontrolovat x</strong> ověří celočíselné řešení.
            </li>
          </ul>
        </>
      )
    case 'expand':
      return wrap(
        <>
          {commonTiles}
          <h3 className="controls-help__h">Roznásobování</h3>
          <ul className="controls-help__list">
            <li>Roznásobený výraz zapište za rovnítko; klávesnice doplňuje vstup.</li>
            <li>
              <strong>Zkontrolovat výraz</strong> porovná zápis s rozsahem až do stupně 3 u
              jednočlenu.
            </li>
            <li>
              <strong>Zkontrolovat dlaždice</strong> ověří součet dlaždic na ploše s očekávaným
              polynomem (člen <MathText text="x³" /> jde ověřit hlavně zápisem v poli).
            </li>
          </ul>
        </>
      )
    case 'free':
      return wrap(
        <>
          {commonTiles}
          <h3 className="controls-help__h">Volné plátno</h3>
          <p className="controls-help__p">
            Bez konkrétního zadání — používejte jen zásobník a pracovní plochu.
          </p>
        </>
      )
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>('menu')
  const [factorLevel, setFactorLevel] = useState<FactorLevel>('basic')
  const [task, setTask] = useState<FactorTask>(() =>
    generateFactorTask('basic')
  )
  const [simplifyLevel, setSimplifyLevel] = useState<SimplifyLevel>('basic')
  const [simplifyTask, setSimplifyTask] = useState<SimplifyTask>(() =>
    generateSimplifyTask('basic')
  )
  const [simplifyAnswer, setSimplifyAnswer] = useState('')
  const simplifyInputRef = useRef<HTMLInputElement>(null)
  const prevSimplifyTaskIdRef = useRef<string | null>(null)
  const [equationLevel, setEquationLevel] = useState<EquationLevel>('basic')
  const [linearTask, setLinearTask] = useState<EquationTask>(() =>
    generateEquationTask('basic')
  )
  const [equationAnswer, setEquationAnswer] = useState('')
  const prevLinearTaskIdRef = useRef<string | null>(null)

  const [expandKind, setExpandKind] = useState<ExpandKind>('monomial')
  const [expandLevel, setExpandLevel] = useState<ExpandLevel>('basic')
  const [expandTask, setExpandTask] = useState<ExpandTask>(() =>
    generateExpandTask('monomial', 'basic')
  )
  const [expandAnswer, setExpandAnswer] = useState('')
  const expandInputRef = useRef<HTMLInputElement>(null)
  const prevExpandTaskIdRef = useRef<string | null>(null)

  const enterEquationMode = useCallback((level: EquationLevel) => {
    setEquationLevel(level)
    setLinearTask(generateEquationTask(level))
    prevLinearTaskIdRef.current = null
    setTiles([])
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setEquationAnswer('')
  }, [])

  const enterFactorMode = useCallback((level: FactorLevel) => {
    setFactorLevel(level)
    setTask(generateFactorTask(level))
    setTiles([])
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setFactorExpr1('')
    setFactorExpr2('')
  }, [])

  const enterSimplifyMode = useCallback((level: SimplifyLevel) => {
    setRoute('simplify')
    setSimplifyLevel(level)
    setSimplifyTask(generateSimplifyTask(level))
    prevSimplifyTaskIdRef.current = null
    setTiles([])
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setSimplifyAnswer('')
  }, [])

  /** Pozice levého horního rohu průhledného náhledu při tahu ze zásobníku (viewport). */
  const [bankGhostPos, setBankGhostPos] = useState<{
    x: number
    y: number
  } | null>(null)
  /** Fixed náhled při tahu dlaždice z plochy — viditelný i nad zásobníkem (overflow scroll ji jinak ořezává). */
  const [tileGhostPos, setTileGhostPos] = useState<{
    x: number
    y: number
  } | null>(null)

  const [tiles, setTiles] = useState<PlacedTile[]>([])
  const [selectedTileIds, setSelectedTileIds] = useState<string[]>([])
  const [lassoPreview, setLassoPreview] = useState<{
    left: number
    top: number
    w: number
    h: number
  } | null>(null)
  const [drag, setDrag] = useState<DragMode>(null)
  /** Výsledek kontroly odpovědi — vždy jen krátká zpráva v postranním panelu. */
  const [checkFeedback, setCheckFeedback] = useState<
    'success' | 'fail' | null
  >(null)
  const [showControlsHelp, setShowControlsHelp] = useState(false)

  /** Režim „Volné plátno“ — chrome jako geometry-app (FreeGeometryEditor). */
  const [freeZoom, setFreeZoom] = useState(1)
  const [freeDark, setFreeDark] = useState(false)
  const [freeShowGrid, setFreeShowGrid] = useState(true)
  /** Prostřední sloupec mřížky = rovnítko; rozdělený zápis v horním boxu. */
  const [freeEqualsMode, setFreeEqualsMode] = useState(false)
  const [freeRecording, setFreeRecording] = useState(false)
  const [freeShowNotes, setFreeShowNotes] = useState(false)
  const [freeNotes, setFreeNotes] = useState('')
  const [freeSessionLog, setFreeSessionLog] = useState<FreeSessionLogEntry[]>(
    []
  )
  const [freeRecordingSteps, setFreeRecordingSteps] = useState<
    FreeRecordingStep[]
  >([])
  const [freeRecordingShowEditor, setFreeRecordingShowEditor] = useState(false)
  const [freeRecordingShowPlayer, setFreeRecordingShowPlayer] = useState(false)
  const [freeRecordingPlayerIndex, setFreeRecordingPlayerIndex] = useState(-1)
  /** Přehrávání — ID dlaždic nulového páru (před odstraněním) ke ztlumení a přeškrtnutí. */
  const [freePlaybackStrikeTileIds, setFreePlaybackStrikeTileIds] = useState<
    string[]
  >([])
  /** Krátká animace „vypaření“ po zrušení nulového páru na volném plátně. */
  const [freeZeroPairVaporFx, setFreeZeroPairVaporFx] = useState<{
    tileA: PlacedTile
    tileB: PlacedTile
  } | null>(null)
  const [freeEditableRecordingSteps, setFreeEditableRecordingSteps] = useState<
    FreeRecordingStep[]
  >([])
  const [freeRecordingName, setFreeRecordingName] = useState('')
  /** Zvýraznění buněk mřížky při tahu (souřadnice vnitřního plátna). */
  const [freeGridDropPreview, setFreeGridDropPreview] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  /** Volné plátno — posun (ruka) vs. výběr a úpravy dlaždic. */
  const [freeCanvasTool, setFreeCanvasTool] = useState<'move' | 'select'>(
    'select'
  )
  const freeCanvasToolRef = useRef(freeCanvasTool)
  freeCanvasToolRef.current = freeCanvasTool
  const freePanCleanupRef = useRef<(() => void) | null>(null)
  const freeZoomRef = useRef(freeZoom)
  const freeRecordingRef = useRef(false)
  freeZoomRef.current = freeZoom
  freeRecordingRef.current = freeRecording
  /** Celé lineární činitele (obsah závorky), např. x+3 nebo 2x-1. */
  const [factorExpr1, setFactorExpr1] = useState('')
  const [factorExpr2, setFactorExpr2] = useState('')
  /** Který činitel dostává znaky z matematické klávesnice. */
  const [factorKbTarget, setFactorKbTarget] = useState<'1' | '2'>('1')
  const [viewSize, setViewSize] = useState(() => {
    if (typeof window === 'undefined') return { w: 960, h: 700 }
    return {
      w: Math.max(320, window.innerWidth - 140),
      h: Math.max(280, window.innerHeight - 160),
    }
  })

  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  const freeEqualsModeRef = useRef(freeEqualsMode)
  freeEqualsModeRef.current = freeEqualsMode
  /** Aktuální sloupec rovnítka — doplňuje se až po useMemo `freeEqBandLeft` níže. */
  const freeEqBandLeftRef = useRef(0)
  const routeRef = useRef(route)
  routeRef.current = route

  const boardRef = useRef<HTMLDivElement>(null)
  /** Volné plátno — vnitřní uzel se scale(zoom); getBoundingClientRect odpovídá vizuálnímu plátnu. */
  const freeBoardInnerRef = useRef<HTMLDivElement>(null)
  /** Po obdélníkovém výběru potlačí následující klik na plochu, který by smazal výběr. */
  const suppressNextBoardClearRef = useRef(false)
  const freeLassoCleanupRef = useRef<(() => void) | null>(null)
  const freeHistoryPastRef = useRef<PlacedTile[][]>([])
  const freeHistoryFutureRef = useRef<PlacedTile[][]>([])
  const applyingFreeHistoryRef = useRef(false)
  const previousTilesForRecordingRef = useRef<PlacedTile[] | null>(null)
  const recordingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const freeRecordingStepsRef = useRef<FreeRecordingStep[]>([])
  /** Globální posluchače tahu — musí být připojené synchronně v pointerdown, jinak rychlé puštění nestihne useEffect. */
  const dragSessionCleanupRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const factorInput1Ref = useRef<HTMLInputElement>(null)
  const factorInput2Ref = useRef<HTMLInputElement>(null)
  /**
   * Před změnou freeZoom uložíme rozměry scrollu; po překreslení v useLayoutEffect
   * nastavíme scroll tak, aby střed výřezu ukazoval stejný relativní bod obsahu.
   */
  const freeZoomScrollPreserveRef = useRef<{
    sl0: number
    st0: number
    /** Zoom před změnou (transform: scale(z0), origin top-left). */
    z0: number
    /** Odsazení vnitřního plátna v obalu před změnou (centrování při zoomu). */
    padX0: number
    padY0: number
    /** Velikost výřezu před změnou zoomu (pro střed výřezu). */
    cw0: number
    ch0: number
    targetZ: number
  } | null>(null)
  /** Po vstupu na volné plátno jednou vycentrovat scroll na střed plochy (ne levý horní roh). */
  const freeCanvasCenteredOnceRef = useRef(false)
  const commitFreeZoomRef = useRef<(z: number) => void>(() => {})
  /** Alias kvůli starým odkazům / rozbitému HMR (stejný objekt jako commitFreeZoomRef). */
  const applyFreeZoomRef = commitFreeZoomRef

  useEffect(() => {
    setShowControlsHelp(false)
  }, [route])

  useEffect(() => {
    if (route !== 'free') setFreeEqualsMode(false)
  }, [route])

  useEffect(() => {
    if (route === 'free') return
    freeLassoCleanupRef.current?.()
    freeLassoCleanupRef.current = null
    setLassoPreview(null)
  }, [route])

  useEffect(() => {
    if (route !== 'free') {
      freeHistoryPastRef.current = []
      freeHistoryFutureRef.current = []
    }
  }, [route])

  useEffect(() => {
    if (route !== 'free') return
    try {
      setFreeNotes(localStorage.getItem(FREE_NOTES_STORAGE_KEY) ?? '')
    } catch {
      /* ignore */
    }
    setFreeSessionLog([])
    setFreeRecording(false)
    setFreeRecordingSteps([])
    freeRecordingStepsRef.current = []
    setFreeRecordingShowEditor(false)
    setFreeRecordingShowPlayer(false)
    setFreeRecordingPlayerIndex(-1)
    setFreePlaybackStrikeTileIds([])
    setFreeZeroPairVaporFx(null)
    setFreeEditableRecordingSteps([])
    setFreeRecordingName('')
    previousTilesForRecordingRef.current = null
    if (recordingDebounceRef.current) {
      clearTimeout(recordingDebounceRef.current)
      recordingDebounceRef.current = null
    }
    setFreeShowNotes(false)
    setFreeZoom(1)
    setFreeCanvasTool('select')
  }, [route])

  useEffect(() => {
    if (route !== 'free') return
    try {
      localStorage.setItem(FREE_NOTES_STORAGE_KEY, freeNotes)
    } catch {
      /* ignore */
    }
  }, [freeNotes, route])

  useEffect(() => {
    freeRecordingStepsRef.current = freeRecordingSteps
  }, [freeRecordingSteps])

  useEffect(() => {
    if (!freeZeroPairVaporFx) return
    const id = window.setTimeout(() => setFreeZeroPairVaporFx(null), 640)
    return () => window.clearTimeout(id)
  }, [freeZeroPairVaporFx])

  /** Automatické zachytávání kroků při nahrávání (debounce 50 ms jako ve FreeGeometryEditor). */
  useEffect(() => {
    if (route !== 'free') return
    if (!freeRecording || freeRecordingShowPlayer || freeRecordingShowEditor) {
      previousTilesForRecordingRef.current = clonePlacedTilesList(tiles)
      if (recordingDebounceRef.current) {
        clearTimeout(recordingDebounceRef.current)
        recordingDebounceRef.current = null
      }
      return
    }
    if (applyingFreeHistoryRef.current) {
      previousTilesForRecordingRef.current = clonePlacedTilesList(tiles)
      if (recordingDebounceRef.current) {
        clearTimeout(recordingDebounceRef.current)
        recordingDebounceRef.current = null
      }
      return
    }
    if (!previousTilesForRecordingRef.current) {
      previousTilesForRecordingRef.current = clonePlacedTilesList(tiles)
      return
    }
    if (recordingDebounceRef.current) {
      clearTimeout(recordingDebounceRef.current)
    }
    recordingDebounceRef.current = window.setTimeout(() => {
      recordingDebounceRef.current = null
      const cur = tilesRef.current
      const prev = previousTilesForRecordingRef.current
      if (!prev) return
      const meta = describeTilesRecordingStep(prev, cur)
      if (meta) {
        const notation = freeCanvasMathNotation(cur, {
          equalsMode: freeEqualsModeRef.current,
          eqBandLeft: freeEqBandLeftRef.current,
        })
        const step: FreeRecordingStep = {
          id: `step-${Date.now()}-${Math.random()}`,
          actionType: meta.actionType,
          description: meta.description,
          notation,
          snapshot: clonePlacedTilesList(cur),
        }
        setFreeRecordingSteps((s) => {
          const next = [...s, step]
          freeRecordingStepsRef.current = next
          return next
        })
        setFreeSessionLog((l) => [
          ...l,
          { t: Date.now(), msg: `${notation} — ${meta.description}` },
        ])
      }
      previousTilesForRecordingRef.current = clonePlacedTilesList(cur)
    }, 50)
  }, [
    tiles,
    freeRecording,
    route,
    freeRecordingShowPlayer,
    freeRecordingShowEditor,
  ])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || route !== 'free') return
    let raf: number | null = null
    let wheelAccum = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      wheelAccum += e.deltaY
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        const d = wheelAccum
        wheelAccum = 0
        if (d === 0) return
        const next = clampFreeZoom(freeZoomRef.current * Math.exp(-d * 0.00055))
        /* Zoom vždy ze středu výřezu (stejně jako slider / tlačítka). */
        applyFreeZoomRef.current(next)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [route])

  useEffect(() => {
    if (!drag || route !== 'free') setFreeGridDropPreview(null)
  }, [drag, route])

  const recordFreeTilesMutation = useCallback(
    (prev: PlacedTile[], next: PlacedTile[]) => {
      if (prev === next || tilesStateEqual(prev, next)) return
      if (routeRef.current !== 'free' || applyingFreeHistoryRef.current) return
      freeHistoryPastRef.current.push(prev.map((t) => ({ ...t })))
      if (freeHistoryPastRef.current.length > FREE_TILE_HISTORY_LIMIT) {
        freeHistoryPastRef.current.shift()
      }
      freeHistoryFutureRef.current = []
    },
    []
  )

  const onUndoFree = useCallback(() => {
    if (routeRef.current !== 'free') return
    const past = freeHistoryPastRef.current
    if (past.length === 0) return
    applyingFreeHistoryRef.current = true
    const snapshot = past.pop()!
    freeHistoryFutureRef.current.push(
      tilesRef.current.map((t) => ({ ...t }))
    )
    setTiles(snapshot)
    setSelectedTileIds((sel) =>
      sel.filter((id) => snapshot.some((t) => t.id === id))
    )
    applyingFreeHistoryRef.current = false
  }, [])

  const onRedoFree = useCallback(() => {
    if (routeRef.current !== 'free') return
    const future = freeHistoryFutureRef.current
    if (future.length === 0) return
    applyingFreeHistoryRef.current = true
    const snapshot = future.pop()!
    freeHistoryPastRef.current.push(
      tilesRef.current.map((t) => ({ ...t }))
    )
    setTiles(snapshot)
    setSelectedTileIds((sel) =>
      sel.filter((id) => snapshot.some((t) => t.id === id))
    )
    applyingFreeHistoryRef.current = false
  }, [])

  useEffect(() => {
    if (route !== 'free') return
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target?.closest(
          'textarea, input, select, [contenteditable="true"], [contenteditable=""]'
        )
      ) {
        return
      }
      if (freeRecordingShowPlayer || freeRecordingShowEditor) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        if (e.shiftKey) onRedoFree()
        else onUndoFree()
        return
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        onRedoFree()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    route,
    onUndoFree,
    onRedoFree,
    freeRecordingShowPlayer,
    freeRecordingShowEditor,
  ])

  const onToggleFreeRecording = useCallback(() => {
    if (freeRecording) {
      const steps = freeRecordingStepsRef.current
      if (steps.length === 0) {
        setFreeRecording(false)
        previousTilesForRecordingRef.current = null
        if (recordingDebounceRef.current) {
          clearTimeout(recordingDebounceRef.current)
          recordingDebounceRef.current = null
        }
        return
      }
      setFreeEditableRecordingSteps(
        steps.map((s) => ({
          ...s,
          snapshot: clonePlacedTilesList(s.snapshot),
        }))
      )
      setFreeRecordingShowEditor(true)
      setFreeRecording(false)
    } else {
      previousTilesForRecordingRef.current = clonePlacedTilesList(
        tilesRef.current
      )
      setFreeRecordingSteps([])
      freeRecordingStepsRef.current = []
      setFreeSessionLog([])
      setFreeRecording(true)
    }
  }, [freeRecording])

  const applyFreeRecordingPlaybackAtIndex = useCallback((index: number) => {
    const steps = freeRecordingStepsRef.current
    setSelectedTileIds([])
    if (index < 0 || steps.length === 0) {
      setTiles([])
      setFreePlaybackStrikeTileIds([])
      return
    }
    const step = steps[index]!
    if (step.actionType === 'zero-pair' && index > 0) {
      const prevSnap = steps[index - 1]!.snapshot
      const curSnap = step.snapshot
      const curIds = new Set(curSnap.map((t) => t.id))
      const removedIds = prevSnap
        .filter((t) => !curIds.has(t.id))
        .map((t) => t.id)
      setTiles(clonePlacedTilesList(prevSnap))
      setFreePlaybackStrikeTileIds(removedIds)
    } else {
      setTiles(clonePlacedTilesList(step.snapshot))
      setFreePlaybackStrikeTileIds([])
    }
  }, [])

  const onRecordingEditorDone = useCallback(() => {
    const next = freeEditableRecordingSteps.map((s) => ({
      ...s,
      snapshot: clonePlacedTilesList(s.snapshot),
    }))
    setFreeRecordingSteps(next)
    freeRecordingStepsRef.current = next
    setFreeRecordingShowEditor(false)
    setFreeRecordingShowPlayer(true)
    setFreeRecordingPlayerIndex(-1)
    setTiles([])
    setSelectedTileIds([])
    setFreePlaybackStrikeTileIds([])
  }, [freeEditableRecordingSteps])

  const onRecordingEditorRequestClose = useCallback(() => {
    setFreeEditableRecordingSteps(
      freeRecordingSteps.map((s) => ({
        ...s,
        snapshot: clonePlacedTilesList(s.snapshot),
      }))
    )
    setFreeRecordingShowEditor(false)
    setFreeRecordingShowPlayer(true)
    setFreeRecordingPlayerIndex(-1)
    setTiles([])
    setSelectedTileIds([])
    setFreePlaybackStrikeTileIds([])
  }, [freeRecordingSteps])

  const onRecordingPlayerNext = useCallback(() => {
    setFreeRecordingPlayerIndex((i) => {
      const steps = freeRecordingStepsRef.current
      if (steps.length === 0) return i
      const next = Math.min(steps.length - 1, i + 1)
      queueMicrotask(() => {
        if (next >= 0 && next < steps.length) {
          applyFreeRecordingPlaybackAtIndex(next)
        }
      })
      return next
    })
  }, [applyFreeRecordingPlaybackAtIndex])

  const onRecordingPlayerPrev = useCallback(() => {
    setFreeRecordingPlayerIndex((i) => {
      const steps = freeRecordingStepsRef.current
      const prev = Math.max(-1, i - 1)
      queueMicrotask(() => {
        if (prev >= 0 && prev < steps.length) {
          applyFreeRecordingPlaybackAtIndex(prev)
        } else {
          setTiles([])
          setFreePlaybackStrikeTileIds([])
          setSelectedTileIds([])
        }
      })
      return prev
    })
  }, [applyFreeRecordingPlaybackAtIndex])

  const onRecordingPlayerExit = useCallback(() => {
    const steps = freeRecordingStepsRef.current
    if (steps.length > 0) {
      const last = steps[steps.length - 1]
      setTiles(clonePlacedTilesList(last.snapshot))
    }
    setFreeRecordingShowPlayer(false)
    setFreeRecordingPlayerIndex(-1)
    setFreePlaybackStrikeTileIds([])
  }, [])

  const onRecordingPlayerEditSteps = useCallback(() => {
    setFreeEditableRecordingSteps(
      freeRecordingStepsRef.current.map((s) => ({
        ...s,
        snapshot: clonePlacedTilesList(s.snapshot),
      }))
    )
    setFreeRecordingShowPlayer(false)
    setFreeRecordingShowEditor(true)
    setFreePlaybackStrikeTileIds([])
  }, [])

  const onCopyFreeRecordingJson = useCallback(() => {
    const name = freeRecordingName.trim() || 'Záznam z plátna'
    const payload = {
      name,
      version: 1,
      steps: freeRecordingStepsRef.current.map((s) => ({
        id: s.id,
        actionType: s.actionType,
        description: s.description,
        notation: s.notation,
        snapshot: s.snapshot,
      })),
    }
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
  }, [freeRecordingName])

  const applyTask = useCallback(() => {
    setTiles((prev) => {
      if (route === 'free' && prev.length > 0) {
        recordFreeTilesMutation(prev, [])
      }
      return []
    })
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setFactorExpr1('')
    setFactorExpr2('')
    setEquationAnswer('')
    setExpandAnswer('')
  }, [route, recordFreeTilesMutation])

  useEffect(() => {
    if (route !== 'factor') return
    applyTask()
    setFactorKbTarget('1')
  }, [task, route, applyTask])

  useEffect(() => {
    if (route !== 'simplify') return
    if (prevSimplifyTaskIdRef.current === simplifyTask.id) return
    prevSimplifyTaskIdRef.current = simplifyTask.id
    setTiles([])
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setSimplifyAnswer('')
  }, [simplifyTask.id, route])

  useEffect(() => {
    if (route !== 'equation') return
    if (prevLinearTaskIdRef.current === linearTask.id) return
    prevLinearTaskIdRef.current = linearTask.id
    setTiles([])
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setEquationAnswer('')
  }, [linearTask.id, route])

  useEffect(() => {
    if (route !== 'expand') return
    if (prevExpandTaskIdRef.current === expandTask.id) return
    prevExpandTaskIdRef.current = expandTask.id
    setTiles([])
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setExpandAnswer('')
  }, [expandTask.id, route])

  useEffect(() => {
    if (route !== 'expand') return
    setExpandTask(generateExpandTask(expandKind, expandLevel))
  }, [route, expandKind, expandLevel])

  /**
   * Velikost výřezu workspace — jen okno + změna route.
   * ResizeObserver tady dělal smyčku se zoomem (každý zoom mění scrollWidth → measure → setState → sekání).
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const ew = Math.round(el.clientWidth || rect.width || 0)
      const eh = Math.round(el.clientHeight || rect.height || 0)
      const ww = typeof window !== 'undefined' ? window.innerWidth : 800
      const wh = typeof window !== 'undefined' ? window.innerHeight : 600
      const w = Math.max(200, ew, Math.round(ww - 160))
      const h = Math.max(200, eh, Math.round(wh - 140))
      setViewSize((prev) =>
        prev.w !== w || prev.h !== h ? { w, h } : prev
      )
    }
    measure()
    const t = window.setTimeout(measure, 0)
    let rafOuter = 0
    let rafInner = 0
    rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(measure)
    })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.clearTimeout(t)
      cancelAnimationFrame(rafOuter)
      cancelAnimationFrame(rafInner)
    }
  }, [route])

  const tileGeom: TileGeomMode = route === 'free' ? 'freeGrid' : 'algebra'
  const { gw, gh: ghTiles } = useMemo(
    () => resizeToFitTiles(tiles, tileGeom),
    [tiles, tileGeom]
  )
  /**
   * Logická velikost plátna nesmí záviset na zoomu — při zoomu jen škálujeme (transform).
   * Dříve zde byl ceil(viewSize/z), takže se innerW při každém oddálení měnil, rozbíjelo to
   * přepočet scrollu „bod ve středu výřezu zůstane uprostřed“.
   */
  const innerW = Math.max(gw, viewSize.w)
  const innerH = Math.max(ghTiles, viewSize.h)
  const innerWRef = useRef(innerW)
  const innerHRef = useRef(innerH)
  innerWRef.current = innerW
  innerHRef.current = innerH

  const viewSizeRef = useRef(viewSize)
  viewSizeRef.current = viewSize

  const scaledInnerW = innerW * freeZoom
  const scaledInnerH = innerH * freeZoom
  const freeBoardOuterW = Math.max(scaledInnerW, viewSize.w)
  const freeBoardOuterH = Math.max(scaledInnerH, viewSize.h)
  /** Vnitřní plátno vycentrované v obalu — při zoomu drží střed a vyplní výřez. */
  const freeInnerPadX = (freeBoardOuterW - scaledInnerW) / 2
  const freeInnerPadY = (freeBoardOuterH - scaledInnerH) / 2

  const commitFreeZoom = useCallback((raw: number) => {
    const z = clampFreeZoom(raw)
    const zPrev = freeZoomRef.current
    if (Math.abs(z - zPrev) < 1e-9) return
    const el = scrollRef.current
    if (route === 'free' && el) {
      const cw = el.clientWidth
      const ch = el.clientHeight
      const iw = innerWRef.current
      const ih = innerHRef.current
      const sw = iw * zPrev
      const sh = ih * zPrev
      const vw = viewSizeRef.current.w
      const vh = viewSizeRef.current.h
      const ow0 = Math.max(sw, vw)
      const oh0 = Math.max(sh, vh)
      const padX0 = (ow0 - sw) / 2
      const padY0 = (oh0 - sh) / 2
      freeZoomScrollPreserveRef.current = {
        sl0: el.scrollLeft,
        st0: el.scrollTop,
        z0: zPrev,
        padX0,
        padY0,
        cw0: cw,
        ch0: ch,
        targetZ: z,
      }
    }
    setFreeZoom(z)
  }, [route])

  commitFreeZoomRef.current = commitFreeZoom

  /** Závislosti vždy stejná délka pole — jinak React Fast Refresh hlásí chybu. */
  useLayoutEffect(() => {
    if (route !== 'free') return
    const p = freeZoomScrollPreserveRef.current
    if (!p || p.targetZ !== freeZoom) return
    freeZoomScrollPreserveRef.current = null

    const el = scrollRef.current
    if (!el) return

    const scrollW = el.scrollWidth
    const scrollH = el.scrollHeight
    const { sl0, st0, z0 } = p
    const z1 = freeZoom

    if (scrollW <= 0 || scrollH <= 0 || z0 <= 0 || z1 <= 0) return

    const padX0Prev = p.padX0 ?? 0
    const padY0Prev = p.padY0 ?? 0
    const cw0 = p.cw0 > 0 ? p.cw0 : el.clientWidth
    const ch0 = p.ch0 > 0 ? p.ch0 : el.clientHeight
    const scaledW = innerW * z1
    const scaledH = innerH * z1
    const ow1 = Math.max(scaledW, viewSize.w)
    const oh1 = Math.max(scaledH, viewSize.h)
    const padX1 = (ow1 - scaledW) / 2
    const padY1 = (oh1 - scaledH) / 2

    /* Střed výřezu před zoomem v souřadnicích dokumentu → po zoomu zůstane uprostřed. */
    const docCx0 = sl0 + cw0 / 2
    const docCy0 = st0 + ch0 / 2
    const ix = (docCx0 - padX0Prev) / z0
    const iy = (docCy0 - padY0Prev) / z0
    const docCx1 = ix * z1 + padX1
    const docCy1 = iy * z1 + padY1

    const cw1 = el.clientWidth
    const ch1 = el.clientHeight
    const sl = docCx1 - cw1 / 2
    const st = docCy1 - ch1 / 2
    const maxSl = Math.max(0, scrollW - cw1)
    const maxSt = Math.max(0, scrollH - ch1)
    el.scrollLeft = Math.min(maxSl, Math.max(0, sl))
    el.scrollTop = Math.min(maxSt, Math.max(0, st))
  }, [freeZoom, route, innerW, innerH, viewSize.w, viewSize.h])

  useEffect(() => {
    if (route !== 'free') {
      freeZoomScrollPreserveRef.current = null
      freeCanvasCenteredOnceRef.current = false
    }
  }, [route])

  /** Při prvním zobrazení volného plátna: střed logické plochy do středu výřezu (ne 0,0). */
  useLayoutEffect(() => {
    if (route !== 'free') return
    if (freeCanvasCenteredOnceRef.current) return
    if (freeZoomScrollPreserveRef.current) return

    const el = scrollRef.current
    if (!el) return

    const z = freeZoom
    const scaledW = innerW * z
    const scaledH = innerH * z
    const ow = Math.max(scaledW, viewSize.w)
    const oh = Math.max(scaledH, viewSize.h)
    const padX = (ow - scaledW) / 2
    const padY = (oh - scaledH) / 2
    const cw = el.clientWidth
    const ch = el.clientHeight
    const docW = el.scrollWidth
    const docH = el.scrollHeight
    if (docW <= 0 || docH <= 0 || cw <= 0 || ch <= 0) return

    const cx = padX + (innerW / 2) * z
    const cy = padY + (innerH / 2) * z
    el.scrollLeft = Math.min(
      Math.max(0, docW - cw),
      Math.max(0, cx - cw / 2)
    )
    el.scrollTop = Math.min(
      Math.max(0, docH - ch),
      Math.max(0, cy - ch / 2)
    )
    freeCanvasCenteredOnceRef.current = true
  }, [route, innerW, innerH, freeZoom, viewSize.w, viewSize.h])

  /** Levý okraj buňky mřížky uprostřed šířky plátna (sloupec „rovnítka“). */
  const freeEqBandLeft = useMemo(() => {
    if (route !== 'free') return 0
    const G = FREE_GRID_CELL_PX
    /* Střed podle plochy max(dlaždice, výřez) — ne podle innerW zvětšeného kvůli zoomu,
     * jinak se při oddálení mění sloupec rovnítka. */
    const wMid = Math.max(gw, viewSize.w)
    const col = Math.floor(wMid / 2 / G) * G
    return Math.min(Math.max(0, innerW - G), col)
  }, [route, innerW, gw, viewSize.w])
  freeEqBandLeftRef.current = freeEqBandLeft

  const freeEqPartition = useMemo(() => {
    if (route !== 'free' || !freeEqualsMode) return null
    return partitionTilesByEqualsColumn(
      tiles,
      freeEqBandLeft,
      FREE_GRID_CELL_PX,
      'freeGrid'
    )
  }, [route, freeEqualsMode, tiles, freeEqBandLeft])

  const tryPlaceFromBankAt = useCallback(
    (key: BankKey, px: number, py: number) => {
      const { kind, negative } = parseBankKey(key)
      const baseId = crypto.randomUUID()
      const G = FREE_GRID_CELL_PX
      let rawX: number
      let rawY: number
      if (routeRef.current === 'free') {
        rawX = Math.max(0, Math.round(px / G) * G)
        rawY = Math.max(0, Math.round(py / G) * G)
      } else {
        rawX = Math.max(0, snapCoord(px))
        rawY = Math.max(0, snapCoord(py))
      }
      const draft: PlacedTile = {
        id: baseId,
        kind,
        negative,
        rot: 0,
        x: rawX,
        y: rawY,
      }

      setTiles((prev) => {
        const candidate: PlacedTile =
          routeRef.current === 'free'
            ? draft
            : {
                ...draft,
                ...magneticPosition(
                  draft,
                  rawX,
                  rawY,
                  prev,
                  MAGNET_SNAP_PX
                ),
              }
        const geom: TileGeomMode =
          routeRef.current === 'free' ? 'freeGrid' : 'algebra'
        const pair = prev.find((o) =>
          tilesAreZeroPairOverlapping(candidate, o, geom)
        )
        if (pair) {
          if (routeRef.current === 'free') {
            queueMicrotask(() =>
              setFreeZeroPairVaporFx({
                tileA: { ...candidate },
                tileB: { ...pair },
              })
            )
          }
          const next = prev.filter((t) => t.id !== pair.id)
          recordFreeTilesMutation(prev, next)
          return next
        }
        const next = [...prev, candidate]
        if (!hasOverlap(next, geom)) {
          recordFreeTilesMutation(prev, next)
          return next
        }
        const loose: PlacedTile = { ...draft, x: rawX, y: rawY }
        const nextLoose = [...prev, loose]
        if (!hasOverlap(nextLoose, geom)) {
          recordFreeTilesMutation(prev, nextLoose)
          return nextLoose
        }
        return prev
      })
    },
    [recordFreeTilesMutation]
  )

  const moveTileTo = useCallback(
    (
      id: string,
      px: number,
      py: number,
      mode: 'board' | 'liveDrag' = 'board'
    ) => {
      const rawX =
        mode === 'liveDrag' ? snapCoord(px) : Math.max(0, snapCoord(px))
      const rawY =
        mode === 'liveDrag' ? snapCoord(py) : Math.max(0, snapCoord(py))
      setTiles((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx < 0) return prev
        const t = prev[idx]
        const others = prev.filter((x) => x.id !== id)
        if (mode === 'liveDrag') {
          const next: PlacedTile = { ...t, x: rawX, y: rawY }
          const copy = [...prev]
          copy[idx] = next
          return copy
        }
        const { x, y } = magneticPosition(
          t,
          rawX,
          rawY,
          others,
          MAGNET_SNAP_PX
        )
        const next: PlacedTile = { ...t, x, y }
        const copy = [...prev]
        copy[idx] = next
        return copy
      })
    },
    []
  )

  const moveTilesLiveBatch = useCallback(
    (updates: { id: string; x: number; y: number }[]) => {
      setTiles((prev) => {
        const copy = [...prev]
        let changed = false
        for (const { id, x, y } of updates) {
          const idx = copy.findIndex((t) => t.id === id)
          if (idx < 0) continue
          const t = copy[idx]
          const rawX = snapCoord(x)
          const rawY = snapCoord(y)
          if (t.x !== rawX || t.y !== rawY) {
            copy[idx] = { ...t, x: rawX, y: rawY }
            changed = true
          }
        }
        return changed ? copy : prev
      })
    },
    []
  )

  const duplicatePlacedTile = useCallback(
    (source: PlacedTile) => {
      if (drag) return
      const r = routeRef.current
      if (r === 'menu') return
      const isFree = r === 'free'
      setTiles((prev) => {
        const draft = tryPlaceDuplicate(source, prev, isFree)
        if (!draft) return prev
        const next = [...prev, draft]
        recordFreeTilesMutation(prev, next)
        return next
      })
    },
    [drag, recordFreeTilesMutation]
  )

  const duplicatePlacedTilesGroup = useCallback(
    (ids: string[]) => {
      if (drag) return
      const r = routeRef.current
      if (r === 'menu' || ids.length === 0) return
      const isFree = r === 'free'
      const ordered = [...ids].sort((a, b) => {
        const ta = tilesRef.current.find((t) => t.id === a)
        const tb = tilesRef.current.find((t) => t.id === b)
        if (!ta || !tb) return a.localeCompare(b)
        if (ta.y !== tb.y) return ta.y - tb.y
        if (ta.x !== tb.x) return ta.x - tb.x
        return a.localeCompare(b)
      })
      setTiles((prev) => {
        let cur = prev
        for (const id of ordered) {
          const source = cur.find((t) => t.id === id)
          if (!source) continue
          const dup = tryPlaceDuplicate(source, cur, isFree)
          if (!dup) continue
          cur = [...cur, dup]
        }
        if (cur === prev) return prev
        recordFreeTilesMutation(prev, cur)
        return cur
      })
    },
    [drag, recordFreeTilesMutation]
  )

  useEffect(() => {
    if (!drag || drag.kind !== 'fromBank') {
      setBankGhostPos(null)
    }
  }, [drag])

  useEffect(() => {
    if (!drag || drag.kind !== 'tile') {
      setTileGhostPos(null)
    }
  }, [drag])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (drag?.kind === 'tile') {
      el.classList.add('workspace-scroll--tile-live-drag')
      return () => {
        el.classList.remove('workspace-scroll--tile-live-drag')
      }
    }
  }, [drag])

  useEffect(() => {
    return () => {
      dragSessionCleanupRef.current?.()
      dragSessionCleanupRef.current = null
      freePanCleanupRef.current?.()
      freePanCleanupRef.current = null
      freeLassoCleanupRef.current?.()
      freeLassoCleanupRef.current = null
    }
  }, [])

  const handleGlobalPointerUp = useCallback(
    (e: PointerEvent, active: DragTile | DragFromBank) => {
      const rNow = routeRef.current
      const cx = e.clientX
      const cy = e.clientY
      const hit = document.elementFromPoint(cx, cy)
      const dropOnBankChrome =
        rNow === 'free'
          ? Boolean(hit?.closest(FREE_BANK_CHROME_SEL))
          : Boolean(hit?.closest('[data-bank-drop]'))

      if (active.kind === 'tile') {
        const groupIds = Object.keys(active.memberOrigins)
        const groupSet = new Set(groupIds)

        if (dropOnBankChrome) {
          setTiles((prev) => {
            const next = prev.filter((t) => !groupSet.has(t.id))
            if (next.length === prev.length) return prev
            recordFreeTilesMutation(prev, next)
            return next
          })
          queueMicrotask(() =>
            setSelectedTileIds((sel) => sel.filter((id) => !groupSet.has(id)))
          )
          return
        }

        if (rNow === 'free' && groupIds.length > 1) {
          setTiles((prev) => {
            const restoreGroup = (): PlacedTile[] =>
              prev.map((t) =>
                groupSet.has(t.id) && active.memberOrigins[t.id]
                  ? {
                      ...t,
                      x: active.memberOrigins[t.id].gx,
                      y: active.memberOrigins[t.id].gy,
                    }
                  : t
              )

            const eqLeft = freeEqBandLeftRef.current
            const stage =
              freeEqualsModeRef.current
                ? prev.map((tile) => {
                    if (!groupSet.has(tile.id)) return tile
                    const orig = active.memberOrigins[tile.id]
                    if (!orig) return tile
                    const before = freeTileEquationSide(
                      orig.gx,
                      tile.kind,
                      tile.rot,
                      eqLeft
                    )
                    const after = freeTileEquationSide(
                      tile.x,
                      tile.kind,
                      tile.rot,
                      eqLeft
                    )
                    if (before !== after) {
                      return { ...tile, negative: !tile.negative }
                    }
                    return tile
                  })
                : prev

            const working = eliminateAllZeroPairs(stage, 'freeGrid')
            if (hasOverlap(working, 'freeGrid')) {
              const rev = restoreGroup()
              if (tilesStateEqual(prev, rev)) return prev
              recordFreeTilesMutation(prev, rev)
              return rev
            }
            if (tilesStateEqual(prev, working)) return prev
            recordFreeTilesMutation(prev, working)
            queueMicrotask(() =>
              setSelectedTileIds((sel) =>
                sel.filter((id) => working.some((wt) => wt.id === id))
              )
            )
            return working
          })
          return
        }

        const geom: TileGeomMode = rNow === 'free' ? 'freeGrid' : 'algebra'
        const dragId = active.id
        const o0 = active.memberOrigins[dragId]
        if (!o0) return
        const originGx = o0.gx
        const originGy = o0.gy
        setTiles((prev) => {
          const t = prev.find((x) => x.id === dragId)
          if (!t) return prev
          const others = prev.filter((x) => x.id !== dragId)
          const pair = others.find((o) =>
            tilesAreZeroPairOverlapping(t, o, geom)
          )
          if (pair) {
            if (rNow === 'free') {
              queueMicrotask(() =>
                setFreeZeroPairVaporFx({
                  tileA: { ...t },
                  tileB: { ...pair },
                })
              )
            }
            const next = prev.filter(
              (p) => p.id !== dragId && p.id !== pair.id
            )
            recordFreeTilesMutation(prev, next)
            queueMicrotask(() =>
              setSelectedTileIds((sel) =>
                sel.filter((sid) => sid !== dragId && sid !== pair.id)
              )
            )
            return next
          }
          if (overlapsOthers([...others, t], t, geom)) {
            const next = prev.map((p) =>
              p.id === dragId ? { ...p, x: originGx, y: originGy } : p
            )
            if (tilesStateEqual(prev, next)) return prev
            recordFreeTilesMutation(prev, next)
            return next
          }
          const g = FREE_GRID_CELL_PX
          const settled: PlacedTile =
            rNow === 'free'
              ? {
                  ...t,
                  x: Math.max(0, Math.round(t.x / g) * g),
                  y: Math.max(0, Math.round(t.y / g) * g),
                }
              : {
                  ...t,
                  ...magneticPosition(
                    t,
                    Math.max(0, snapCoord(t.x)),
                    Math.max(0, snapCoord(t.y)),
                    others,
                    MAGNET_SNAP_PX
                  ),
                }
          let toPlace = settled
          if (rNow === 'free' && freeEqualsModeRef.current) {
            const before = freeTileEquationSide(
              originGx,
              t.kind,
              t.rot,
              freeEqBandLeftRef.current
            )
            const after = freeTileEquationSide(
              settled.x,
              settled.kind,
              settled.rot,
              freeEqBandLeftRef.current
            )
            if (before !== after) {
              toPlace = { ...settled, negative: !settled.negative }
            }
          }
          if (overlapsOthers([...others, toPlace], toPlace, geom)) {
            const next = prev.map((p) =>
              p.id === dragId ? { ...p, x: originGx, y: originGy } : p
            )
            if (tilesStateEqual(prev, next)) return prev
            recordFreeTilesMutation(prev, next)
            return next
          }
          const next = prev.map((p) =>
            p.id === dragId ? toPlace : p
          )
          recordFreeTilesMutation(prev, next)
          return next
        })
        return
      }

      if (active.kind === 'fromBank') {
        const outer = boardRef.current
        if (!outer) return
        const ro = outer.getBoundingClientRect()
        const insideOuter =
          cx >= ro.left && cx <= ro.right && cy >= ro.top && cy <= ro.bottom
        const { w, h } = active

        if (rNow === 'free') {
          const pill = outer.ownerDocument.querySelector(
            '.bank-sidebar--free-tools'
          )
          const pr = pill?.getBoundingClientRect()
          const overPill =
            !!pr &&
            cx >= pr.left &&
            cx <= pr.right &&
            cy >= pr.top &&
            cy <= pr.bottom
          const releaseOnBankChrome =
            overPill && Boolean(hit?.closest(FREE_BANK_CHROME_SEL))
          if (insideOuter && !releaseOnBankChrome) {
            const inner = freeBoardInnerRef.current
            if (!inner) return
            const origin = inner.getBoundingClientRect()
            const rw = Math.max(1e-6, origin.width)
            const rh = Math.max(1e-6, origin.height)
            const sx = innerWRef.current / rw
            const sy = innerHRef.current / rh
            const px = (cx - origin.left) * sx - w / 2
            const py = (cy - origin.top) * sy - h / 2
            tryPlaceFromBankAt(active.key, px, py)
          }
        } else if (insideOuter && !dropOnBankChrome) {
          const px = snapCoord((cx - ro.left) - w / 2)
          const py = snapCoord((cy - ro.top) - h / 2)
          tryPlaceFromBankAt(active.key, px, py)
        }
      }
    },
    [tryPlaceFromBankAt, recordFreeTilesMutation]
  )

  const updateFreeGridPreview = useCallback(
    (clientX: number, clientY: number, tileW: number, tileH: number) => {
      if (routeRef.current !== 'free') {
        setFreeGridDropPreview(null)
        return
      }
      const outer = boardRef.current
      const inner = freeBoardInnerRef.current
      if (!outer || !inner) {
        setFreeGridDropPreview(null)
        return
      }
      const ro = outer.getBoundingClientRect()
      if (
        clientX < ro.left ||
        clientX > ro.right ||
        clientY < ro.top ||
        clientY > ro.bottom
      ) {
        setFreeGridDropPreview(null)
        return
      }
      const hit = document.elementFromPoint(clientX, clientY)
      if (hit?.closest(FREE_BANK_CHROME_SEL)) {
        setFreeGridDropPreview(null)
        return
      }
      const origin = inner.getBoundingClientRect()
      const { x: sx, y: sy } = freeInnerPointerToGridTopLeft(
        clientX,
        clientY,
        tileW,
        tileH,
        origin,
        innerWRef.current,
        innerHRef.current
      )
      const { w: hw, h: hh } = freeInnerGridHighlightSize(tileW, tileH)
      setFreeGridDropPreview({ x: sx, y: sy, w: hw, h: hh })
    },
    []
  )

  const attachGlobalDragListeners = useCallback(
    (d: DragTile | DragFromBank, pointerId: number) => {
      dragSessionCleanupRef.current?.()
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        if (d.kind === 'fromBank') {
          setBankGhostPos({
            x: ev.clientX - d.grabOffX,
            y: ev.clientY - d.grabOffY,
          })
          if (routeRef.current === 'free') {
            updateFreeGridPreview(ev.clientX, ev.clientY, d.w, d.h)
          }
          return
        }
        const memberKeys = Object.keys(d.memberOrigins)
        const isGroupDrag = memberKeys.length > 1
        if (!isGroupDrag) {
          setTileGhostPos({
            x: ev.clientX - d.grabOffX,
            y: ev.clientY - d.grabOffY,
          })
        }
        const z = routeRef.current === 'free' ? freeZoomRef.current : 1
        const leaderO = d.memberOrigins[d.id]
        if (!leaderO) return
        const tLive = tilesRef.current.find((x) => x.id === d.id)
        const freeG = routeRef.current === 'free'
        const { w: tw, h: th } = tLive
          ? tileFootprintForMode(
              tLive.kind,
              tLive.rot,
              freeG ? 'freeGrid' : 'algebra'
            )
          : freeG
            ? tileFootprintFreeGrid('x2', 0)
            : { w: X_PX, h: X_PX }
        if (routeRef.current === 'free') {
          const G = FREE_GRID_CELL_PX
          const innerEl = freeBoardInnerRef.current
          let rawNx = leaderO.gx + (ev.clientX - d.startPx) / z
          let rawNy = leaderO.gy + (ev.clientY - d.startPy) / z
          if (innerEl) {
            const r = innerEl.getBoundingClientRect()
            const rw = Math.max(1e-6, r.width)
            const rh = Math.max(1e-6, r.height)
            const sx = innerWRef.current / rw
            const sy = innerHRef.current / rh
            rawNx = leaderO.gx + (ev.clientX - d.startPx) * sx
            rawNy = leaderO.gy + (ev.clientY - d.startPy) * sy
          }
          const nx = Math.max(0, Math.round(rawNx / G) * G)
          const ny = Math.max(0, Math.round(rawNy / G) * G)
          const dx = nx - leaderO.gx
          const dy = ny - leaderO.gy
          const updates = memberKeys.map((mid) => {
            const o = d.memberOrigins[mid]
            if (!o) return null
            return {
              id: mid,
              x: Math.max(0, Math.round((o.gx + dx) / G) * G),
              y: Math.max(0, Math.round((o.gy + dy) / G) * G),
            }
          }).filter((u): u is { id: string; x: number; y: number } => u !== null)
          moveTilesLiveBatch(updates)
          let minX = Infinity
          let minY = Infinity
          let maxR = -Infinity
          let maxB = -Infinity
          for (const u of updates) {
            const t = tilesRef.current.find((x) => x.id === u.id)
            const { w: fw, h: fh } = t
              ? tileFootprintForMode(t.kind, t.rot, 'freeGrid')
              : { w: tw, h: th }
            minX = Math.min(minX, u.x)
            minY = Math.min(minY, u.y)
            maxR = Math.max(maxR, u.x + fw)
            maxB = Math.max(maxB, u.y + fh)
          }
          if (minX !== Infinity) {
            setFreeGridDropPreview({
              x: minX,
              y: minY,
              w: maxR - minX,
              h: maxB - minY,
            })
          }
        } else {
          const nx =
            leaderO.gx +
            Math.round((ev.clientX - d.startPx) / z / SNAP_PX) * SNAP_PX
          const ny =
            leaderO.gy +
            Math.round((ev.clientY - d.startPy) / z / SNAP_PX) * SNAP_PX
          if (isGroupDrag) {
            const dx = nx - leaderO.gx
            const dy = ny - leaderO.gy
            const updates = memberKeys.map((mid) => {
              const o = d.memberOrigins[mid]
              if (!o) return null
              return {
                id: mid,
                x: Math.max(0, snapCoord(o.gx + dx)),
                y: Math.max(0, snapCoord(o.gy + dy)),
              }
            }).filter((u): u is { id: string; x: number; y: number } => u !== null)
            moveTilesLiveBatch(updates)
          } else {
            moveTileTo(d.id, nx, ny, 'liveDrag')
          }
        }
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        dragSessionCleanupRef.current?.()
        dragSessionCleanupRef.current = null
        setFreeGridDropPreview(null)
        handleGlobalPointerUp(ev, d)
        setDrag(null)
      }
      const remove = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
      }
      dragSessionCleanupRef.current = remove
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    },
    [handleGlobalPointerUp, moveTileTo, moveTilesLiveBatch, updateFreeGridPreview]
  )

  const onBankPointerDown = (key: BankKey, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const { kind } = parseBankKey(key)
    const { w, h } =
      route === 'free'
        ? tileFootprintFreeGrid(kind, 0)
        : tileFootprintForMode(kind, 0, 'algebra')
    const el = e.currentTarget as HTMLElement
    const br = el.getBoundingClientRect()
    const grabOffX = e.clientX - br.left
    const grabOffY = e.clientY - br.top
    const d: DragFromBank = {
      kind: 'fromBank',
      key,
      w,
      h,
      grabOffX,
      grabOffY,
    }
    setDrag(d)
    setBankGhostPos({
      x: e.clientX - grabOffX,
      y: e.clientY - grabOffY,
    })
    attachGlobalDragListeners(d, e.pointerId)
    if (route === 'free') {
      updateFreeGridPreview(e.clientX, e.clientY, w, h)
    }
  }

  const onTilePointerDown = (tile: PlacedTile, e: React.PointerEvent) => {
    if (routeRef.current === 'free' && freeCanvasToolRef.current === 'move') {
      return
    }
    e.stopPropagation()
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const br = el.getBoundingClientRect()
    const grabOffX = e.clientX - br.left
    const grabOffY = e.clientY - br.top

    const isFree = routeRef.current === 'free'
    const multiDrag =
      isFree &&
      selectedTileIds.length > 1 &&
      selectedTileIds.includes(tile.id)
    const members = multiDrag
      ? selectedTileIds.filter((id) => tiles.some((t) => t.id === id))
      : [tile.id]

    const memberOrigins: Record<string, { gx: number; gy: number }> = {}
    for (const id of members) {
      const t = tiles.find((x) => x.id === id)
      if (t) memberOrigins[id] = { gx: t.x, gy: t.y }
    }

    if (members.length <= 1) {
      setSelectedTileIds([tile.id])
      setTileGhostPos({
        x: e.clientX - grabOffX,
        y: e.clientY - grabOffY,
      })
    } else {
      setTileGhostPos(null)
    }

    const d: DragTile = {
      kind: 'tile',
      id: tile.id,
      startPx: e.clientX,
      startPy: e.clientY,
      memberOrigins,
      grabOffX,
      grabOffY,
    }
    setDrag(d)
    attachGlobalDragListeners(d, e.pointerId)
    if (route === 'free') {
      const G = FREE_GRID_CELL_PX
      if (members.length <= 1) {
        const { w, h } = tileFootprintForMode(tile.kind, tile.rot, 'freeGrid')
        const sx = Math.max(0, Math.round(tile.x / G) * G)
        const sy = Math.max(0, Math.round(tile.y / G) * G)
        const { w: hw, h: hh } = freeInnerGridHighlightSize(w, h)
        setFreeGridDropPreview({ x: sx, y: sy, w: hw, h: hh })
      } else {
        let minX = Infinity
        let minY = Infinity
        let maxR = -Infinity
        let maxB = -Infinity
        for (const id of members) {
          const t = tiles.find((x) => x.id === id)
          if (!t) continue
          const { w, h } = tileFootprintForMode(t.kind, t.rot, 'freeGrid')
          minX = Math.min(minX, t.x)
          minY = Math.min(minY, t.y)
          maxR = Math.max(maxR, t.x + w)
          maxB = Math.max(maxB, t.y + h)
        }
        if (minX !== Infinity) {
          setFreeGridDropPreview({
            x: minX,
            y: minY,
            w: maxR - minX,
            h: maxB - minY,
          })
        }
      }
    }
  }

  const onTilePointerUp = (_e: React.PointerEvent) => {}

  const flipTileSign = useCallback(
    (tile: PlacedTile) => {
      if (drag) return
      setTiles((prev) => {
        const t = prev.find((x) => x.id === tile.id)
        if (!t) return prev
        const flipped: PlacedTile = { ...t, negative: !t.negative }
        const others = prev.filter((x) => x.id !== tile.id)
        const geom: TileGeomMode = route === 'free' ? 'freeGrid' : 'algebra'
        const pair = others.find((o) =>
          tilesAreZeroPairOverlapping(flipped, o, geom)
        )
        let next: PlacedTile[]
        if (pair) {
          if (route === 'free') {
            queueMicrotask(() =>
              setFreeZeroPairVaporFx({
                tileA: { ...flipped },
                tileB: { ...pair },
              })
            )
          }
          next = others.filter((p) => p.id !== pair.id)
          queueMicrotask(() =>
            setSelectedTileIds((sel) =>
              sel.filter((sid) => sid !== tile.id && sid !== pair.id)
            )
          )
        } else if (route === 'free') {
          const adjusted: PlacedTile = { ...flipped }
          if (overlapsOthers([...others, adjusted], adjusted, 'freeGrid'))
            return prev
          next = prev.map((x) => (x.id === tile.id ? adjusted : x))
        } else {
          const { x, y } = magneticPosition(
            flipped,
            flipped.x,
            flipped.y,
            others,
            MAGNET_SNAP_PX
          )
          const adjusted: PlacedTile = { ...flipped, x, y }
          if (overlapsOthers([...others, adjusted], adjusted)) return prev
          next = prev.map((x) => (x.id === tile.id ? adjusted : x))
        }
        if (tilesStateEqual(prev, next)) return prev
        recordFreeTilesMutation(prev, next)
        return next
      })
    },
    [drag, route, recordFreeTilesMutation]
  )

  const onTileContextMenu = (tile: PlacedTile, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    flipTileSign(tile)
  }

  const onTileDoubleClick = (tile: PlacedTile, e: React.MouseEvent) => {
    e.stopPropagation()
    if (tile.kind !== 'x1') return
    setTiles((prev) => {
      const t = prev.find((x) => x.id === tile.id)
      if (!t) return prev
      const rot = (t.rot ^ 1) as 0 | 1
      const turned: PlacedTile = { ...t, rot }
      const others = prev.filter((x) => x.id !== tile.id)
      let next: PlacedTile[]
      if (route === 'free') {
        const turnedTile: PlacedTile = { ...turned }
        if (overlapsOthers([...others, turnedTile], turnedTile, 'freeGrid'))
          return prev
        next = prev.map((x) => (x.id === tile.id ? turnedTile : x))
      } else {
        const { x, y } = magneticPosition(
          turned,
          turned.x,
          turned.y,
          others,
          MAGNET_SNAP_PX
        )
        const turnedMag: PlacedTile = { ...turned, x, y }
        if (overlapsOthers([...others, turnedMag], turnedMag)) return prev
        next = prev.map((x) => (x.id === tile.id ? turnedMag : x))
      }
      if (tilesStateEqual(prev, next)) return prev
      recordFreeTilesMutation(prev, next)
      return next
    })
  }

  const onBoardClick = () => {
    if (suppressNextBoardClearRef.current) {
      suppressNextBoardClearRef.current = false
      return
    }
    setSelectedTileIds([])
  }

  const flipTileSignGroup = useCallback(
    (ids: string[]) => {
      if (drag || ids.length === 0) return
      setTiles((prev) => {
        const isFree = routeRef.current === 'free'
        const { next, selectionIds } = applyGroupFlip(prev, ids, isFree)
        queueMicrotask(() => setSelectedTileIds(selectionIds))
        if (next === prev || tilesStateEqual(prev, next)) return prev
        recordFreeTilesMutation(prev, next)
        return next
      })
    },
    [drag, recordFreeTilesMutation]
  )

  const onFreeBoardInnerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (routeRef.current !== 'free' || freeCanvasToolRef.current !== 'select') {
        return
      }
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (target?.closest('.free-selection-chrome')) return
      if (target?.closest('.algebra-tile')) return
      const inner = freeBoardInnerRef.current
      if (!inner || e.currentTarget !== inner) return
      e.stopPropagation()
      freeLassoCleanupRef.current?.()
      const origin = inner.getBoundingClientRect()
      const rw = Math.max(1e-6, origin.width)
      const rh = Math.max(1e-6, origin.height)
      const sx = innerWRef.current / rw
      const sy = innerHRef.current / rh
      const x0 = (e.clientX - origin.left) * sx
      const y0 = (e.clientY - origin.top) * sy
      const state = { pointerId: e.pointerId, x0, y0, x1: x0, y1: y0 }
      const applyPreview = () => {
        const left = Math.min(state.x0, state.x1)
        const top = Math.min(state.y0, state.y1)
        const w = Math.abs(state.x1 - state.x0)
        const h = Math.abs(state.y1 - state.y0)
        setLassoPreview({ left, top, w, h })
      }
      applyPreview()
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return
        state.x1 = (ev.clientX - origin.left) * sx
        state.y1 = (ev.clientY - origin.top) * sy
        applyPreview()
      }
      const finish = (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        freeLassoCleanupRef.current = null
        setLassoPreview(null)
        const bw = Math.abs(state.x1 - state.x0)
        const bh = Math.abs(state.y1 - state.y0)
        suppressNextBoardClearRef.current = true
        if (bw < LASSO_MIN_DRAG_PX && bh < LASSO_MIN_DRAG_PX) {
          setSelectedTileIds([])
          return
        }
        const left = Math.min(state.x0, state.x1)
        const top = Math.min(state.y0, state.y1)
        const right = Math.max(state.x0, state.x1)
        const bottom = Math.max(state.y0, state.y1)
        const picked = tilesRef.current
          .filter((t) =>
            tileIntersectsLassoRect(t, 'freeGrid', left, top, right, bottom)
          )
          .map((t) => t.id)
        setSelectedTileIds(picked)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
      freeLassoCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
      }
    },
    []
  )

  const freeMultiSelectionChrome = useMemo(() => {
    if (route !== 'free' || selectedTileIds.length <= 1) return null
    const picked = selectedTileIds
      .map((id) => tiles.find((t) => t.id === id))
      .filter((t): t is PlacedTile => Boolean(t))
    if (picked.length <= 1) return null
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const t of picked) {
      const { w, h } = tileFootprintForMode(t.kind, t.rot, 'freeGrid')
      left = Math.min(left, t.x)
      top = Math.min(top, t.y)
      right = Math.max(right, t.x + w)
      bottom = Math.max(bottom, t.y + h)
    }
    const neg = picked.every((t) => t.negative)
    const pos = picked.every((t) => !t.negative)
    const signMode = neg ? 'neg' : pos ? 'pos' : 'mixed'
    return {
      left,
      top,
      w: right - left,
      h: bottom - top,
      signMode,
      ids: picked.map((t) => t.id),
    }
  }, [route, tiles, selectedTileIds])

  const onFreeWorkspacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (routeRef.current !== 'free' || freeCanvasToolRef.current !== 'move') {
        return
      }
      if (e.button !== 0) return
      const sc = scrollRef.current
      if (!sc) return
      e.preventDefault()
      const state = {
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        sl0: sc.scrollLeft,
        st0: sc.scrollTop,
      }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return
        sc.scrollLeft = state.sl0 - (ev.clientX - state.x0)
        sc.scrollTop = state.st0 - (ev.clientY - state.y0)
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        freePanCleanupRef.current = null
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      freePanCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    },
    []
  )

  const checkSimplify = useCallback(() => {
    const parsed = parseQuadratic(simplifyAnswer)
    if (!parsed) {
      setCheckFeedback('fail')
      return
    }
    const expected = {
      a: simplifyTask.a,
      b: simplifyTask.b,
      c: simplifyTask.c,
    }
    if (quadraticsEqual(parsed, expected)) {
      setCheckFeedback('success')
    } else {
      setCheckFeedback('fail')
    }
  }, [simplifyAnswer, simplifyTask])

  const checkExpand = useCallback(() => {
    const parsed = parsePolynomialUpTo3(expandAnswer)
    if (!parsed) {
      setCheckFeedback('fail')
      return
    }
    if (polyUpTo3Equal(parsed, expandTask.expected)) {
      setCheckFeedback('success')
    } else {
      setCheckFeedback('fail')
    }
  }, [expandAnswer, expandTask])

  const checkBoardTilesSolution = useCallback(() => {
    if (route !== 'factor' && route !== 'expand') {
      setCheckFeedback('fail')
      return
    }
    if (tiles.length === 0 || hasOverlap(tiles)) {
      setCheckFeedback('fail')
      return
    }
    const fromTiles = polynomialFromPlacedTiles(tiles)
    const expected =
      route === 'factor'
        ? { a3: 0, a2: task.a, a1: task.b, a0: task.c }
        : expandTask.expected
    if (polyUpTo3Equal(fromTiles, expected)) {
      setCheckFeedback('success')
    } else {
      setCheckFeedback('fail')
    }
  }, [tiles, route, task, expandTask])

  const checkEquation = useCallback(() => {
    const raw = equationAnswer.trim()
    if (raw === '') {
      setCheckFeedback('fail')
      return
    }
    const parsed = parseFactorNumber(raw)
    if (!Number.isFinite(parsed)) {
      setCheckFeedback('fail')
      return
    }
    const expected = equationSolutionX(linearTask)
    if (parsed === expected) {
      setCheckFeedback('success')
    } else {
      setCheckFeedback('fail')
    }
  }, [equationAnswer, linearTask])

  const checkFactorization = () => {
    if (factorExpr1.trim() === '' || factorExpr2.trim() === '') {
      setCheckFeedback('fail')
      return
    }

    const f1 = parseLinearBinomial(factorExpr1)
    const f2 = parseLinearBinomial(factorExpr2)
    if (!f1 || !f2) {
      setCheckFeedback('fail')
      return
    }

    const w1 = f1.w
    const k1 = f1.k
    const w2 = f2.w
    const k2 = f2.k

    if (![w1, k1, w2, k2].every(Number.isFinite)) {
      setCheckFeedback('fail')
      return
    }

    if (matchesFactorization(task.a, task.b, task.c, w1, k1, w2, k2)) {
      setCheckFeedback('success')
    } else {
      setCheckFeedback('fail')
    }
  }

  const polyDisplay = formatPolynomial(task)

  const equationScaffold = useMemo(
    () => (route === 'equation' ? equationScaffoldSides(linearTask) : null),
    [route, linearTask]
  )

  const tileDragGhostTile =
    drag?.kind === 'tile'
      ? (tiles.find((x) => x.id === drag.id) ?? null)
      : null

  if (route === 'menu') {
    return (
      <div className="app app--fill main-menu">
        <header className="main-menu__hero">
          <h1 className="main-menu__title">Algebraické dlaždice</h1>
          <button
            type="button"
            className="btn secondary main-menu__help-toggle"
            aria-expanded={showControlsHelp}
            aria-controls="controls-help-panel"
            onClick={() => setShowControlsHelp((v) => !v)}
          >
            {showControlsHelp
              ? 'Skrýt nápovědu k ovládání'
              : 'Nápověda k ovládání'}
          </button>
          {showControlsHelp && <ControlsHelpPanel route="menu" />}
        </header>
        <div className="main-menu__grid" role="navigation" aria-label="Režim aplikace">
          <button
            type="button"
            className="main-menu__card"
            onClick={() => {
              setRoute('free')
              setTiles([])
              setSelectedTileIds([])
              setDrag(null)
              setCheckFeedback(null)
            }}
          >
            <span className="main-menu__card-title">Volné plátno</span>
          </button>
          <button
            type="button"
            className="main-menu__card"
            onClick={() => {
              setRoute('equation')
              enterEquationMode('basic')
            }}
          >
            <span className="main-menu__card-title">Rovnice</span>
          </button>
          <button
            type="button"
            className="main-menu__card"
            onClick={() => enterSimplifyMode('basic')}
          >
            <span className="main-menu__card-title">Zjednodušování</span>
          </button>
          <button
            type="button"
            className="main-menu__card"
            onClick={() => {
              setRoute('expand')
              setExpandKind('monomial')
              setExpandLevel('basic')
              prevExpandTaskIdRef.current = null
              setTiles([])
              setSelectedTileIds([])
              setDrag(null)
              setCheckFeedback(null)
              setExpandAnswer('')
            }}
          >
            <span className="main-menu__card-title">Roznásobování</span>
          </button>
          <button
            type="button"
            className="main-menu__card"
            onClick={() => {
              setRoute('factor')
              enterFactorMode('basic')
            }}
          >
            <span className="main-menu__card-title">Rozklad na součin</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`app app--fill${route === 'free' ? ' app--free-geometry' : ''}${route === 'free' && freeDark ? ' app--free-dark' : ''}${route === 'free' && (freeRecordingShowPlayer || freeRecordingShowEditor) ? ' app--free-playback' : ''}${route === 'free' && freeRecordingShowPlayer ? ' app--free-rec-player-active' : ''}`}
    >
      {route !== 'free' ? (
        <header className="app__header app__header--compact">
          <h1>
            Algebraické dlaždice – {APP_MODE_HEADING[route]}
          </h1>
          <button
            type="button"
            className="btn secondary controls-help-toggle"
            aria-expanded={showControlsHelp}
            aria-controls="controls-help-panel"
            onClick={() => setShowControlsHelp((v) => !v)}
          >
            {showControlsHelp
              ? 'Skrýt nápovědu k ovládání'
              : 'Nápověda k ovládání'}
          </button>
          {showControlsHelp && <ControlsHelpPanel route={route} />}
        </header>
      ) : null}

      <div
        className={`app__body${route === 'free' ? ' app__body--free-rail' : ''}`}
      >
        <aside
          className={`bank-sidebar${route === 'free' ? ' bank-sidebar--free-tools' : ' panel'}`}
          data-bank-drop
          draggable={route === 'free' ? false : undefined}
          onDragStart={
            route === 'free'
              ? (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }
              : undefined
          }
        >
          {route === 'free' ? (
            <>
              <div
                className="bank-rail__tools"
                role="toolbar"
                aria-label="Nástroje plátna"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={`bank-rail__tool${freeCanvasTool === 'move' ? ' bank-rail__tool--active' : ''}`}
                  aria-pressed={freeCanvasTool === 'move'}
                  aria-label="Posunout plátno"
                  title="Posunout plátno"
                  onClick={() => setFreeCanvasTool('move')}
                >
                  <Hand className="bank-rail__tool-icon" aria-hidden />
                </button>
                <button
                  type="button"
                  className={`bank-rail__tool${freeCanvasTool === 'select' ? ' bank-rail__tool--active' : ''}`}
                  aria-pressed={freeCanvasTool === 'select'}
                  aria-label="Vybrat a přesouvat dlaždice"
                  title="Vybrat a přesouvat dlaždice"
                  onClick={() => setFreeCanvasTool('select')}
                >
                  <MousePointer2 className="bank-rail__tool-icon" aria-hidden />
                </button>
              </div>
              <div
                className="bank-rail__sep bank-rail__sep--vertical"
                aria-hidden="true"
              />
            </>
          ) : null}
          <button
            type="button"
            className={
              route === 'free'
                ? 'bank-rail__back'
                : 'btn secondary main-menu-back'
            }
            {...(route === 'free'
              ? { 'aria-label': 'Hlavní menu', title: 'Zpět do menu' }
              : {})}
            onClick={() => {
              setRoute('menu')
              setCheckFeedback(null)
              setDrag(null)
            }}
          >
            {route === 'free' ? (
              <svg
                className="bank-rail__back-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
            ) : (
              '← Hlavní menu'
            )}
          </button>
          {route === 'free' ? (
            <div
              className="bank-rail__sep bank-rail__sep--vertical"
              aria-hidden="true"
            />
          ) : null}

          {route === 'factor' ? (
            <>
              <div
                className="equation-level-tabs"
                role="tablist"
                aria-label="Úroveň obtížnosti rozkladu"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={factorLevel === 'basic'}
                  className={`equation-level-tab${factorLevel === 'basic' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterFactorMode('basic')}
                >
                  Základní
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={factorLevel === 'advanced'}
                  className={`equation-level-tab${factorLevel === 'advanced' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterFactorMode('advanced')}
                >
                  Pokročilý
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={factorLevel === 'master'}
                  className={`equation-level-tab${factorLevel === 'master' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterFactorMode('master')}
                >
                  Mistr
                </button>
              </div>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setTask(generateFactorTask(factorLevel))}
              >
                Nová náhodná úloha
              </button>
              <div className="sidebar-check-stack">
                <button
                  type="button"
                  className="btn primary"
                  onClick={checkFactorization}
                >
                  Zkontrolovat rozklad
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={checkBoardTilesSolution}
                >
                  Zkontrolovat dlaždice
                </button>
              </div>
            </>
          ) : route === 'simplify' ? (
            <>
              <div
                className="equation-level-tabs"
                role="tablist"
                aria-label="Úroveň obtížnosti zjednodušování"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={simplifyLevel === 'basic'}
                  className={`equation-level-tab${simplifyLevel === 'basic' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterSimplifyMode('basic')}
                >
                  Základní
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={simplifyLevel === 'advanced'}
                  className={`equation-level-tab${simplifyLevel === 'advanced' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterSimplifyMode('advanced')}
                >
                  Pokročilý
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={simplifyLevel === 'master'}
                  className={`equation-level-tab${simplifyLevel === 'master' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterSimplifyMode('master')}
                >
                  Mistr
                </button>
              </div>
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setSimplifyTask(generateSimplifyTask(simplifyLevel))
                }
              >
                Nová náhodná úloha
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={checkSimplify}
              >
                Zkontrolovat zjednodušování
              </button>
            </>
          ) : route === 'equation' ? (
            <>
              <div
                className="equation-level-tabs"
                role="tablist"
                aria-label="Úroveň obtížnosti rovnic"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={equationLevel === 'basic'}
                  className={`equation-level-tab${equationLevel === 'basic' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterEquationMode('basic')}
                >
                  Základní
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={equationLevel === 'advanced'}
                  className={`equation-level-tab${equationLevel === 'advanced' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterEquationMode('advanced')}
                >
                  Pokročilá
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={equationLevel === 'master'}
                  className={`equation-level-tab${equationLevel === 'master' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => enterEquationMode('master')}
                >
                  Mistr
                </button>
              </div>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setLinearTask(generateEquationTask(equationLevel))}
              >
                Nová náhodná úloha
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={checkEquation}
              >
                <MathText text="Zkontrolovat x" />
              </button>
            </>
          ) : route === 'expand' ? (
            <>
              <div
                className="equation-level-tabs"
                role="tablist"
                aria-label="Typ zadání — roznásobování"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={expandKind === 'monomial'}
                  className={`equation-level-tab${expandKind === 'monomial' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => setExpandKind('monomial')}
                >
                  Jednočlenem
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={expandKind === 'polynomial'}
                  className={`equation-level-tab${expandKind === 'polynomial' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => setExpandKind('polynomial')}
                >
                  Mnohočlenem
                </button>
              </div>
              <div
                className="equation-level-tabs"
                role="tablist"
                aria-label="Obtížnost roznásobování"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={expandLevel === 'basic'}
                  className={`equation-level-tab${expandLevel === 'basic' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => setExpandLevel('basic')}
                >
                  Základní
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={expandLevel === 'advanced'}
                  className={`equation-level-tab${expandLevel === 'advanced' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => setExpandLevel('advanced')}
                >
                  Pokročilá
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={expandLevel === 'master'}
                  className={`equation-level-tab${expandLevel === 'master' ? ' equation-level-tab--active' : ''}`}
                  onClick={() => setExpandLevel('master')}
                >
                  Mistr
                </button>
              </div>
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setExpandTask(generateExpandTask(expandKind, expandLevel))
                }
              >
                Nová náhodná úloha
              </button>
              <div className="sidebar-check-stack">
                <button
                  type="button"
                  className="btn primary"
                  onClick={checkExpand}
                >
                  Zkontrolovat výraz
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={checkBoardTilesSolution}
                >
                  Zkontrolovat dlaždice
                </button>
              </div>
            </>
          ) : null}
          {checkFeedback && (
            <p
              className={`feedback feedback--sidebar${checkFeedback === 'success' ? ' feedback--success' : ' feedback--fail'}`}
              role="status"
            >
              {checkFeedback === 'success' ? 'Správně :)' : 'Bohužel :('}
            </p>
          )}
          <h2
            className={`bank-heading${route === 'free' ? ' bank-heading--rail bank-heading--sr-only' : ''}`}
          >
            Zásobník dlaždic
          </h2>
          <div
            className={`bank-grid${route === 'free' ? ' bank-grid--rail' : ''}`}
          >
            {SOURCE_META.map(({ kind, negative, caption }) => {
              const key = bankKey(kind, negative)
              const template: PlacedTile = {
                id: `src-${key}`,
                kind,
                negative,
                rot: 0,
                x: 0,
                y: 0,
              }
              const freeFoot =
                route === 'free' ? tileFootprintFreeGrid(kind, 0) : null
              const railUnderhangPx =
                ALGEBRA_TILE_FRAME_UNDERLAY_SHIFT_PX * FREE_BANK_RAIL_SCALE
              const tileGeom = route === 'free' ? 'freeGrid' : 'algebra'
              const preview = (
                <TileView
                  tile={template}
                  layout="static"
                  selected={false}
                  dragging={false}
                  nonInteractive
                  geometry={tileGeom}
                  onPointerDown={() => {}}
                  onDoubleClick={() => {}}
                />
              )
              return (
                <div key={key} className="bank-cell">
                  <div
                    className={`bank-cell__drop${route === 'free' ? ' bank-cell__drop--free-rail' : ''}`}
                    style={
                      freeFoot
                        ? {
                            width: Math.round(
                              freeFoot.w * FREE_BANK_RAIL_SCALE
                            ),
                            height: Math.round(
                              freeFoot.h * FREE_BANK_RAIL_SCALE +
                                railUnderhangPx
                            ),
                          }
                        : undefined
                    }
                    onPointerDown={(e) => onBankPointerDown(key, e)}
                    title={caption}
                    aria-label={`Přetáhnout dlaždici ${caption}`}
                  >
                    {freeFoot ? (
                      <div
                        className="bank-cell__free-rail-inner"
                        style={{
                          width: freeFoot.w,
                          height: freeFoot.h,
                          transform: `scale(${FREE_BANK_RAIL_SCALE})`,
                          transformOrigin: 'top left',
                        }}
                      >
                        {preview}
                      </div>
                    ) : (
                      preview
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {route === 'free' ? (
            <div
              className="bank-rail__sep bank-rail__sep--vertical"
              aria-hidden="true"
            />
          ) : null}
          <div className="bank-actions">
            <button
              type="button"
              className={
                route === 'free' ? 'bank-rail__clear' : 'btn secondary'
              }
              title={
                route === 'free' ? 'Vyčistit plochu a vstupy' : undefined
              }
              aria-label={
                route === 'free' ? 'Vyčistit plochu a vstupy' : undefined
              }
              onClick={() => applyTask()}
              onTouchEnd={
                route === 'free'
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      applyTask()
                    }
                  : undefined
              }
            >
              {route === 'free' ? (
                <>
                  <Trash2 className="bank-rail__clear-icon" aria-hidden />
                  <span className="bank-rail__clear-tooltip">Vyčistit</span>
                </>
              ) : (
                'Vyčistit plochu a vstupy'
              )}
            </button>
          </div>
        </aside>

        <section
          className={`workspace-column${route === 'free' ? ' workspace-column--free-geo' : ''}`}
        >
          {route === 'free' ? (
            <>
              <FreeCanvasTopBar
                zoom={freeZoom}
                onZoomChange={commitFreeZoom}
                darkMode={freeDark}
                onDarkModeChange={setFreeDark}
                showGrid={freeShowGrid}
                onShowGridChange={setFreeShowGrid}
                equalsMode={freeEqualsMode}
                onEqualsModeChange={setFreeEqualsMode}
              />
              <div
                className={`free-poly-expr${freeDark ? ' free-poly-expr--dark' : ''}${freeEqualsMode ? ' free-poly-expr--equation' : ''}`}
                aria-live="polite"
                aria-label={
                  freeEqPartition
                    ? `Levá strana rovnice: ${formatPolyUpTo3Expr(polynomialFromPlacedTiles(freeEqPartition.left))}; pravá: ${formatPolyUpTo3Expr(polynomialFromPlacedTiles(freeEqPartition.right))}`
                    : `Zápis součtu dlaždic: ${formatPolyUpTo3Expr(polynomialFromPlacedTiles(tiles))}`
                }
              >
                {freeEqPartition ? (
                  <div className="free-poly-expr__equation">
                    <span className="free-poly-expr__side">
                      <MergedColoredPolyExpr tiles={freeEqPartition.left} />
                    </span>
                    <span className="free-poly-expr__eq" aria-hidden>
                      {' '}
                      ={' '}
                    </span>
                    <span className="free-poly-expr__side">
                      <MergedColoredPolyExpr tiles={freeEqPartition.right} />
                    </span>
                  </div>
                ) : (
                  <MergedColoredPolyExpr tiles={tiles} />
                )}
              </div>
              {!freeRecordingShowPlayer && !freeRecordingShowEditor ? (
                <FreeCanvasRightBar
                  darkMode={freeDark}
                  canUndo={
                    route === 'free' && freeHistoryPastRef.current.length > 0
                  }
                  canRedo={
                    route === 'free' && freeHistoryFutureRef.current.length > 0
                  }
                  onUndo={onUndoFree}
                  onRedo={onRedoFree}
                  isRecording={freeRecording}
                  onToggleRecording={onToggleFreeRecording}
                  notesOpen={freeShowNotes}
                  onToggleNotes={() => setFreeShowNotes((o) => !o)}
                  notesBadgeCount={freeSessionLog.length}
                />
              ) : null}
              <FreeCanvasNotesPanel
                open={freeShowNotes}
                onClose={() => setFreeShowNotes(false)}
                darkMode={freeDark}
                notes={freeNotes}
                onNotesChange={setFreeNotes}
                sessionLog={freeSessionLog}
                isRecording={freeRecording}
              />
              <FreeRecordingStepEditor
                open={freeRecordingShowEditor}
                darkMode={freeDark}
                steps={freeEditableRecordingSteps}
                recordingName={freeRecordingName}
                onRecordingNameChange={setFreeRecordingName}
                onStepNotationChange={(index, notation) => {
                  setFreeEditableRecordingSteps((prev) => {
                    const copy = [...prev]
                    copy[index] = { ...copy[index], notation }
                    return copy
                  })
                }}
                onStepDescriptionChange={(index, description) => {
                  setFreeEditableRecordingSteps((prev) => {
                    const copy = [...prev]
                    copy[index] = { ...copy[index], description }
                    return copy
                  })
                }}
                onDone={onRecordingEditorDone}
                onRequestClose={onRecordingEditorRequestClose}
              />
              <FreeRecordingPlayer
                open={freeRecordingShowPlayer}
                darkMode={freeDark}
                equalsMode={freeEqualsMode}
                eqBandLeft={freeEqBandLeft}
                steps={freeRecordingSteps}
                recordingName={freeRecordingName}
                currentStepIndex={freeRecordingPlayerIndex}
                onPrev={onRecordingPlayerPrev}
                onNext={onRecordingPlayerNext}
                onExit={onRecordingPlayerExit}
                onEditSteps={onRecordingPlayerEditSteps}
                onCopyShareJson={onCopyFreeRecordingJson}
              />
            </>
          ) : null}
          <div
            ref={scrollRef}
            className={`workspace-scroll${route === 'free' ? ' workspace-scroll--free-geo' : ''}${route === 'free' && freeDark ? ' workspace-scroll--free-geo-dark' : ''}`}
          >
            {route === 'factor' && (
              <div className="factor-task-panel factor-task-panel--with-keyboard">
                <div
                  className="task-poly-row task-poly-row--on-board"
                  aria-label={`Rozložte výraz: ${polyDisplay}`}
                >
                  <span className="task-poly__lhs">
                    <MathText text={polyDisplay} />
                  </span>
                  <span className="task-poly__eq" aria-hidden>
                    {' '}
                    ={' '}
                  </span>
                  <span className="task-poly__lit">(</span>
                  <input
                    ref={factorInput1Ref}
                    className="factor-bracket-input"
                    type="text"
                    inputMode="text"
                    value={factorExpr1}
                    onChange={(e) => setFactorExpr1(e.target.value)}
                    onFocus={() => setFactorKbTarget('1')}
                    aria-label="První činitel — celý výraz uvnitř závorky"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="task-poly__lit">{`)${MUL_DOT}(`}</span>
                  <input
                    ref={factorInput2Ref}
                    className="factor-bracket-input"
                    type="text"
                    inputMode="text"
                    value={factorExpr2}
                    onChange={(e) => setFactorExpr2(e.target.value)}
                    onFocus={() => setFactorKbTarget('2')}
                    aria-label="Druhý činitel — celý výraz uvnitř závorky"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="task-poly__lit">)</span>
                </div>
                <MathKeyboard
                  inputRef={
                    factorKbTarget === '1' ? factorInput1Ref : factorInput2Ref
                  }
                  value={
                    factorKbTarget === '1' ? factorExpr1 : factorExpr2
                  }
                  onChange={
                    factorKbTarget === '1'
                      ? setFactorExpr1
                      : setFactorExpr2
                  }
                />
              </div>
            )}
            {route === 'simplify' && (
              <div className="simplify-panel">
                <div className="simplify-exercise simplify-exercise--with-answer">
                  <span className="simplify-exercise__label">Zjednodušte:</span>{' '}
                  <strong className="simplify-exercise__expr">
                    <MathText text={simplifyTask.displayString} />
                  </strong>{' '}
                  <span className="simplify-exercise__eq">=</span>{' '}
                  <label className="simplify-exercise__answer">
                    <input
                      ref={simplifyInputRef}
                      className="simplify-answer-input simplify-answer-input--inline"
                      type="text"
                      value={simplifyAnswer}
                      onChange={(e) => setSimplifyAnswer(e.target.value)}
                      aria-label="Zjednodušený výraz"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <MathKeyboard
                  inputRef={simplifyInputRef}
                  value={simplifyAnswer}
                  onChange={setSimplifyAnswer}
                />
              </div>
            )}
            {route === 'equation' && (
              <div className="simplify-panel equation-entry-panel">
                <div
                  className="equation-x-row"
                  role="group"
                  aria-label="Zapište hodnotu x"
                >
                  <span className="equation-x-row__prefix">
                    <MathText text="x" />
                    <span className="equation-x-row__equals" aria-hidden>
                      =
                    </span>
                  </span>
                  <input
                    className="simplify-answer-input equation-x-row__input"
                    type="text"
                    inputMode="decimal"
                    value={equationAnswer}
                    onChange={(e) => setEquationAnswer(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Číslo za rovnítkem"
                  />
                </div>
              </div>
            )}
            {route === 'expand' && (
              <div className="simplify-panel">
                <div className="simplify-exercise simplify-exercise--with-answer">
                  <span className="simplify-exercise__label">Roznásobte:</span>{' '}
                  <strong className="simplify-exercise__expr">
                    <MathText text={expandTask.displayString} />
                  </strong>{' '}
                  <span className="simplify-exercise__eq">=</span>{' '}
                  <label className="simplify-exercise__answer">
                    <input
                      ref={expandInputRef}
                      className="simplify-answer-input simplify-answer-input--inline"
                      type="text"
                      value={expandAnswer}
                      onChange={(e) => setExpandAnswer(e.target.value)}
                      aria-label="Roznásobený polynom"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <MathKeyboard
                  inputRef={expandInputRef}
                  value={expandAnswer}
                  onChange={setExpandAnswer}
                />
              </div>
            )}
            <div className="workspace-board-fill">
              {route === 'free' ? (
                <div
                  ref={boardRef}
                  className={`workspace workspace--free-outer${freeCanvasTool === 'move' ? ' workspace--free-outer--pan-tool' : ''}`}
                  data-workspace
                  style={{
                    width: freeBoardOuterW,
                    height: freeBoardOuterH,
                    minWidth: freeBoardOuterW,
                    minHeight: freeBoardOuterH,
                    position: 'relative',
                    touchAction: freeCanvasTool === 'move' ? 'none' : undefined,
                    ...(freeShowGrid
                      ? {
                          backgroundImage:
                            'linear-gradient(to right, var(--geo-grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--geo-grid-line) 1px, transparent 1px)',
                          backgroundSize: `${FREE_GRID_CELL_PX * freeZoom}px ${FREE_GRID_CELL_PX * freeZoom}px`,
                          backgroundPosition: `${freeInnerPadX}px ${freeInnerPadY}px`,
                        }
                      : {}),
                  }}
                                   onClick={onBoardClick}
                  onPointerDown={onFreeWorkspacePointerDown}
                >
                  {freeEqualsMode && freeShowGrid ? (
                    <div
                      className={`free-eq-band${freeDark ? ' free-eq-band--dark' : ''}`}
                      style={{
                        position: 'absolute',
                        left: freeInnerPadX + freeEqBandLeft * freeZoom,
                        top: 0,
                        width: FREE_GRID_CELL_PX * freeZoom,
                        height: freeBoardOuterH,
                        zIndex: 0,
                        pointerEvents: 'none',
                        boxSizing: 'border-box',
                      }}
                      aria-hidden
                    >
                      <span className="free-eq-band__mark">=</span>
                    </div>
                  ) : null}
                  <div
                    ref={freeBoardInnerRef}
                    className="workspace workspace--free-inner"
                    style={{
                      width: innerW,
                      height: innerH,
                      position: 'absolute',
                      left: freeInnerPadX,
                      top: freeInnerPadY,
                      zIndex: 1,
                      transform: `scale(${freeZoom})`,
                      transformOrigin: 'top left',
                    }}
                    onPointerDown={onFreeBoardInnerPointerDown}
                  >
                    {freeGridDropPreview ? (
                      <div
                        className="free-grid-drop-preview"
                        style={{
                          position: 'absolute',
                          left: freeGridDropPreview.x,
                          top: freeGridDropPreview.y,
                          width: freeGridDropPreview.w,
                          height: freeGridDropPreview.h,
                          pointerEvents: 'none',
                          zIndex: 4,
                          boxSizing: 'border-box',
                        }}
                        aria-hidden
                      />
                    ) : null}
                    {lassoPreview ? (
                      <div
                        className="free-lasso-rect"
                        style={{
                          position: 'absolute',
                          left: lassoPreview.left,
                          top: lassoPreview.top,
                          width: lassoPreview.w,
                          height: lassoPreview.h,
                          pointerEvents: 'none',
                          zIndex: 45,
                          boxSizing: 'border-box',
                        }}
                        aria-hidden
                      />
                    ) : null}
                    {tiles.map((t) => {
                      const inMultiFree =
                        selectedTileIds.length > 1 &&
                        selectedTileIds.includes(t.id)
                      const isGroupTileDrag =
                        drag?.kind === 'tile' &&
                        Object.keys(drag.memberOrigins).length > 1
                      return (
                        <TileView
                          key={t.id}
                          tile={t}
                          layout="board"
                          geometry="freeGrid"
                          selected={selectedTileIds.includes(t.id)}
                          dragging={
                            drag?.kind === 'tile' &&
                            drag.memberOrigins[t.id] !== undefined
                          }
                          concealed={
                            drag?.kind === 'tile' &&
                            drag.id === t.id &&
                            !isGroupTileDrag
                          }
                          playbackZeroPairDim={
                            freeRecordingShowPlayer &&
                            freePlaybackStrikeTileIds.includes(t.id)
                          }
                          onPointerDown={(e) => onTilePointerDown(t, e)}
                          onPointerUp={onTilePointerUp}
                          onDoubleClick={(e) => onTileDoubleClick(t, e)}
                          onContextMenu={(e) => onTileContextMenu(t, e)}
                          onDuplicate={
                            inMultiFree
                              ? undefined
                              : () => duplicatePlacedTile(t)
                          }
                          onFlipSign={
                            inMultiFree
                              ? undefined
                              : () => flipTileSign(t)
                          }
                        />
                      )
                    })}
                    {freeZeroPairVaporFx ? (
                      <>
                        {(
                          [
                            freeZeroPairVaporFx.tileA,
                            freeZeroPairVaporFx.tileB,
                          ] as const
                        ).map((ghostTile, gi) => {
                          const { w: gw, h: gh } = tileFootprintForMode(
                            ghostTile.kind,
                            ghostTile.rot,
                            'freeGrid'
                          )
                          return (
                            <div
                              key={`${ghostTile.id}-${gi}`}
                              className={
                                gi === 1
                                  ? 'free-zero-pair-fx__ghost free-zero-pair-fx__ghost--lag'
                                  : 'free-zero-pair-fx__ghost'
                              }
                              style={{
                                position: 'absolute',
                                left: ghostTile.x,
                                top: ghostTile.y,
                                width: gw,
                                height: gh,
                                zIndex: 70,
                                pointerEvents: 'none',
                                boxSizing: 'border-box',
                              }}
                              aria-hidden
                            >
                              <TileView
                                tile={{ ...ghostTile, x: 0, y: 0 }}
                                layout="static"
                                geometry="freeGrid"
                                nonInteractive
                                selected={false}
                                dragging={false}
                                onPointerDown={() => {}}
                                onDoubleClick={() => {}}
                              />
                            </div>
                          )
                        })}
                      </>
                    ) : null}
                    {freeMultiSelectionChrome && drag?.kind !== 'tile' ? (
                      <div
                        className="free-selection-chrome"
                        style={{
                          position: 'absolute',
                          left: freeMultiSelectionChrome.left,
                          top: freeMultiSelectionChrome.top,
                          width: freeMultiSelectionChrome.w,
                          height: freeMultiSelectionChrome.h,
                          zIndex: 30,
                          pointerEvents: 'none',
                          boxSizing: 'border-box',
                        }}
                      >
                        <span
                          className="free-selection-chrome__bridge-top"
                          aria-hidden
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                        <button
                          type="button"
                          role="switch"
                          aria-checked={
                            freeMultiSelectionChrome.signMode === 'mixed'
                              ? 'mixed'
                              : freeMultiSelectionChrome.signMode === 'neg'
                          }
                          className={`algebra-tile__sign-toggle free-selection-chrome__toggle${
                            freeMultiSelectionChrome.signMode === 'neg'
                              ? ' algebra-tile__sign-toggle--neg'
                              : freeMultiSelectionChrome.signMode === 'pos'
                                ? ' algebra-tile__sign-toggle--pos'
                                : ' algebra-tile__sign-toggle--mixed'
                          }`}
                          aria-label="Přepnout znaménko u vybraných dlaždic"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            flipTileSignGroup(freeMultiSelectionChrome.ids)
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                        >
                          <span
                            className="algebra-tile__sign-toggle__thumb"
                            aria-hidden
                          >
                            {freeMultiSelectionChrome.signMode ===
                            'mixed' ? (
                              <Minus size={12} strokeWidth={2.6} />
                            ) : freeMultiSelectionChrome.signMode ===
                              'neg' ? (
                              <Minus size={12} strokeWidth={2.6} />
                            ) : (
                              <Plus size={12} strokeWidth={2.6} />
                            )}
                          </span>
                        </button>
                        <span
                          className="free-selection-chrome__bridge-bottom"
                          aria-hidden
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                        <button
                          type="button"
                          className="algebra-tile__duplicate free-selection-chrome__duplicate"
                          aria-label="Zkopírovat vybrané dlaždice"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            duplicatePlacedTilesGroup(
                              freeMultiSelectionChrome.ids
                            )
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                        >
                          <Plus size={15} strokeWidth={2.6} aria-hidden />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div
                  ref={boardRef}
                  className="workspace"
                  data-workspace
                  style={{
                    minWidth: innerW,
                    minHeight: innerH,
                  }}
                  onClick={onBoardClick}
                >
                  {route === 'equation' && equationScaffold ? (
                    <div
                      className="workspace-equation-scaffold"
                      style={{
                        left: `calc(${Math.round(viewSize.w / 2)}px + min(13rem, 30vw))`,
                        top: `${Math.round(viewSize.h / 2)}px`,
                      }}
                      aria-hidden
                    >
                      <div className="workspace-equation-scaffold__row" lang="mul">
                        <span className="workspace-equation-scaffold__lhs">
                          <MathText text={equationScaffold.left} />
                        </span>
                        <span className="workspace-equation-scaffold__eq">=</span>
                        <span className="workspace-equation-scaffold__rhs">
                          <MathText text={equationScaffold.right} />
                        </span>
                      </div>
                      <div className="workspace-equation-scaffold__rail">
                        <span className="workspace-equation-scaffold__rail-side" />
                        <div className="workspace-equation-scaffold__rail-col">
                          {Array.from(
                            { length: EQUATION_EXTRA_EQUALS_ROWS },
                            (_, i) => (
                              <span
                                key={i}
                                className="workspace-equation-scaffold__rail-mark"
                              >
                                =
                              </span>
                            )
                          )}
                        </div>
                        <span className="workspace-equation-scaffold__rail-side" />
                      </div>
                    </div>
                  ) : null}
                  {tiles.map((t) => (
                    <TileView
                      key={t.id}
                      tile={t}
                      layout="board"
                      selected={selectedTileIds.includes(t.id)}
                      dragging={drag?.kind === 'tile' && drag.id === t.id}
                      concealed={drag?.kind === 'tile' && drag.id === t.id}
                      onPointerDown={(e) => onTilePointerDown(t, e)}
                      onPointerUp={onTilePointerUp}
                      onDoubleClick={(e) => onTileDoubleClick(t, e)}
                      onContextMenu={(e) => onTileContextMenu(t, e)}
                      onDuplicate={() => duplicatePlacedTile(t)}
                      onFlipSign={() => flipTileSign(t)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {drag?.kind === 'fromBank' && bankGhostPos ? (
        <div
          className="bank-drag-ghost"
          style={{
            position: 'fixed',
            left: bankGhostPos.x,
            top: bankGhostPos.y,
            zIndex: 10000,
            opacity: 0.5,
            pointerEvents: 'none',
          }}
          aria-hidden
        >
          <TileView
            tile={{
              id: 'bank-ghost',
              ...parseBankKey(drag.key),
              rot: 0,
              x: 0,
              y: 0,
            }}
            layout="static"
            selected={false}
            dragging={false}
            nonInteractive
            geometry={route === 'free' ? 'freeGrid' : 'algebra'}
            onPointerDown={() => {}}
            onDoubleClick={() => {}}
          />
        </div>
      ) : null}
      {tileDragGhostTile && tileGhostPos ? (
        <div
          className="tile-drag-ghost"
          style={{
            position: 'fixed',
            left: tileGhostPos.x,
            top: tileGhostPos.y,
            zIndex: 10000,
            opacity: 0.5,
            pointerEvents: 'none',
          }}
          aria-hidden
        >
          <TileView
            tile={tileDragGhostTile}
            layout="static"
            selected={false}
            dragging
            nonInteractive
            geometry={route === 'free' ? 'freeGrid' : 'algebra'}
            onPointerDown={() => {}}
            onPointerUp={() => {}}
            onDoubleClick={() => {}}
          />
        </div>
      ) : null}
    </div>
  )
}
