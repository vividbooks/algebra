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
  FREE_BANK_PREVIEW_MAX_SIDE_PX,
  FREE_CANVAS_PAN_ROOM_PX,
  FREE_WORK_SURFACE_PADDING_PX,
  FREE_EDGE_SNAP_SCREEN_PX,
  FREE_GRID_CELL_PX,
  FREE_WHEEL_ZOOM_DELTA_CAP,
  FREE_WHEEL_ZOOM_EXP_SENSITIVITY,
  freeWheelNormalizeDelta,
  FREE_GRID_X_LONG_PX,
  clampFreeZoom,
  FREE_ZOOM_DEFAULT,
  MUL_DOT,
  TYPO_MINUS,
  UNICODE_MINUS_LIKE_RE,
  X_PX,
} from './constants'
import { TileView } from './components/TileView'
import {
  bankKey,
  duplicateEdgesFree,
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
  type DuplicateFromSide,
  type TileGeomMode,
  type TileKind,
} from './lib/tiles'
import {
  snapFreeMovingGroup,
  type FreeEdgeSnapGuide,
} from './lib/freeEdgeSnap'
import { SimplifyCalculator } from './components/SimplifyCalculator'
import { MergedColoredPolyExpr } from './components/MergedColoredPolyExpr'
import { MathText } from './components/MathText'
import { parseLinearBinomial } from './lib/parseLinearBinomial'
import {
  formatPolyUpTo3Expr,
  parsePolynomialUpTo3,
  polyUpTo3Equal,
} from './lib/parsePolyUpTo3'
import {
  isQuadraticFullyExpandedSingleTerms,
  parseQuadratic,
  quadraticsEqual,
} from './lib/parseQuadratic'
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
  equationSolutionX,
  formatEquationDisplay,
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
import {
  Calculator,
  Check,
  ChevronRight,
  Equal,
  Eraser,
  Expand,
  Hand,
  LayoutGrid,
  Minimize2,
  Minus,
  MousePointer2,
  Plus,
  RefreshCw,
  SplitSquareHorizontal,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

const FREE_NOTES_STORAGE_KEY = 'algebra-tiles-free-notes-v1'

type AppRoute =
  | 'menu'
  | 'factor'
  | 'simplify'
  | 'equation'
  | 'expand'
  | 'free'

function isFreeGeometryRoute(r: AppRoute): boolean {
  return (
    r === 'free' ||
    r === 'equation' ||
    r === 'simplify' ||
    r === 'expand' ||
    r === 'factor'
  )
}

/** Vyhodnocení odpovědi u spodního panelu, ne v postranním zásobníku. */
const ROUTES_WITH_INLINE_ANSWER_FEEDBACK: readonly AppRoute[] = [
  'equation',
  'simplify',
  'expand',
  'factor',
]

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
  FREE_BANK_PREVIEW_MAX_SIDE_PX / FREE_GRID_X_LONG_PX

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

/** Omezí souřadnici na nezápornou — bez zaokrouhlování nebo magnetu. */
function boardClamp(v: number): number {
  return Math.max(0, v)
}

function freeSnapThresholdInner(zoom: number): number {
  return Math.max(2, FREE_EDGE_SNAP_SCREEN_PX / Math.max(zoom, 0.001))
}

const LASSO_MIN_DRAG_PX = 8
/** Tah dlaždice začne až po pohybu — jinak první klik zablokuje dvojklik (otočení x). */
const TILE_DRAG_START_THRESHOLD_PX = 5

function tryPlaceDuplicate(
  source: PlacedTile,
  all: PlacedTile[],
  isFree: boolean,
  preferredSide?: DuplicateFromSide
): PlacedTile | null {
  const geom: TileGeomMode = isFree ? 'freeGrid' : 'algebra'
  const { w, h } = tileFootprintForMode(source.kind, source.rot, geom)
  const x0 = source.x
  const y0 = source.y
  const seen = new Set<string>()
  const rawCandidates: [number, number][] = []
  const pushUnique = (x: number, y: number) => {
    const k = `${x},${y}`
    if (seen.has(k)) return
    seen.add(k)
    rawCandidates.push([x, y])
  }
  if (preferredSide === 'left') pushUnique(x0 - w, y0)
  else if (preferredSide === 'right') pushUnique(x0 + w, y0)
  else if (preferredSide === 'bottom') pushUnique(x0, y0 + h)
  for (let dy = 1; dy <= 28; dy++) pushUnique(x0, y0 + dy * h)
  for (let dx = 1; dx <= 28; dx++) {
    pushUnique(x0 + dx * w, y0)
    pushUnique(x0 - dx * w, y0)
  }
  const tryAt = (rawX: number, rawY: number): PlacedTile | null => {
    const xClamped = boardClamp(rawX)
    const yClamped = boardClamp(rawY)
    const draft: PlacedTile = {
      ...source,
      id: crypto.randomUUID(),
      x: xClamped,
      y: yClamped,
    }
    if (all.some((o) => tilesAreZeroPairOverlapping(draft, o, geom))) {
      return null
    }
    const next = [...all, draft]
    if (!hasOverlap(next, geom)) return draft
    return null
  }
  for (const [rx, ry] of rawCandidates) {
    const d = tryAt(rx, ry)
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
      const adjusted: PlacedTile = {
        ...flipped,
        x: boardClamp(flipped.x),
        y: boardClamp(flipped.y),
      }
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
 * Levý horní roh dlaždice ve vnitřních pixelech plátna (bez přichytávání; jen nezáporné souřadnice).
 * Měřítko bere z poměru CSS rozměru vnitřku (innerW/H) k getBoundingClientRect()
 * (včetně transform na .free-camera), ne z oddělené proměnné zoom — jinak při nesouladu vznikne
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
  const rw = Math.max(1e-6, innerRect.width)
  const rh = Math.max(1e-6, innerRect.height)
  const sx = innerCssW / rw
  const sy = innerCssH / rh
  const px = (clientX - innerRect.left) * sx - tileW / 2
  const py = (clientY - innerRect.top) * sy - tileH / 2
  return {
    x: boardClamp(px),
    y: boardClamp(py),
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
        <li>Kliknutím dlaždici vyberete a zobrazí se ovladače znaménka a kopírování.</li>
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
            Přepněte na záložku <strong>Úlohy</strong> nebo <strong>Volné plátno</strong> a vyberte
            režim. Po vstupu do cvičení otevřete nápovědu v horní liště u názvu aplikace.
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
              Stejné volné plátno jako u roznásobování; zadání (trojčlen a závorky) je dole v
              jedné řádce. Klepnutím do závorky zvolíte, který činitel píšete.
            </li>
            <li>
              Kalkulačku otevřete modrým tlačítkem vedle fajfky; píše do aktivní závorky.
            </li>
            <li>
              Zelená fajfka ověří součin činitelů vůči zobrazenému výrazu.
            </li>
            <li>
              Oranžové obnovení nabídne novou náhodnou úlohu (základní / pokročilý / mistr).
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
            <li>
              Stejné volné plátno jako u rovnic — zadání a pole odpovědi jsou dole v jedné řádce
              jako u rozkladu na součin.
            </li>
            <li>
              Zelené tlačítko s fajfkou <strong>zkontroluje</strong> váš polynom; oranžové obnovení
              nabídne novou úlohu (základní / pokročilý / mistr).
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
              Zadání je nahoře; modelujte rovnici dlaždicemi na ploše — rozdělení stran
              rovnítkem je vždy zapnuté.
            </li>
            <li>
              Hodnotu <MathText text="x" /> zapište do pole dole; zelené tlačítko s fajfkou ověří
              celočíselné řešení.
            </li>
            <li>
              Oranžové <strong>obnovení</strong> nabídne novou náhodnou úlohu — zvolíte úroveň
              (základní, pokročilá, mistr).
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
            <li>
              Volné plátno a zásobník jako u zjednodušování; zadání a výsledek jsou dole v jedné
              řádce jako u rozkladu na součin. Kalkulačku otevřete modrým tlačítkem vedle fajfky.
            </li>
            <li>
              Zelené tlačítko s fajfkou <strong>zkontroluje</strong> váš zápis vůči úloze (polynom až
              do stupně 3).
            </li>
            <li>
              Oranžové <strong>obnovení</strong> otevře výběr typu (jednočlen / mnohočlen) a
              obtížnosti.
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
  const isFreeGeometry = isFreeGeometryRoute(route)
  const [, setFactorLevel] = useState<FactorLevel>('basic')
  const [task, setTask] = useState<FactorTask>(() =>
    generateFactorTask('basic')
  )
  const [, setSimplifyLevel] = useState<SimplifyLevel>('basic')
  const [simplifyTask, setSimplifyTask] = useState<SimplifyTask>(() =>
    generateSimplifyTask('basic')
  )
  const [simplifyAnswer, setSimplifyAnswer] = useState('')
  const simplifyInputRef = useRef<HTMLInputElement>(null)
  const prevSimplifyTaskIdRef = useRef<string | null>(null)
  const [linearTask, setLinearTask] = useState<EquationTask>(() =>
    generateEquationTask('basic')
  )
  const [equationAnswer, setEquationAnswer] = useState('')
  const prevLinearTaskIdRef = useRef<string | null>(null)
  /** Po kliknutí na obnovení — výběr úrovně nové úlohy (sidebar bez záložek). */
  const [equationLevelPickOpen, setEquationLevelPickOpen] = useState(false)
  const [simplifyLevelPickOpen, setSimplifyLevelPickOpen] = useState(false)
  const [simplifyCalculatorOpen, setSimplifyCalculatorOpen] = useState(false)
  const [expandLevelPickOpen, setExpandLevelPickOpen] = useState(false)
  const [expandCalculatorOpen, setExpandCalculatorOpen] = useState(false)
  const [factorLevelPickOpen, setFactorLevelPickOpen] = useState(false)
  const [factorCalculatorOpen, setFactorCalculatorOpen] = useState(false)

  const [expandKind, setExpandKind] = useState<ExpandKind>('monomial')
  const [expandTask, setExpandTask] = useState<ExpandTask>(() =>
    generateExpandTask('monomial', 'basic')
  )
  const [expandAnswer, setExpandAnswer] = useState('')
  const expandInputRef = useRef<HTMLInputElement>(null)
  const prevExpandTaskIdRef = useRef<string | null>(null)

  const enterEquationMode = useCallback((level: EquationLevel) => {
    setRoute('equation')
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

  const enterExpandMode = useCallback((kind: ExpandKind, level: ExpandLevel) => {
    setRoute('expand')
    setExpandKind(kind)
    setExpandTask(generateExpandTask(kind, level))
    prevExpandTaskIdRef.current = null
    setTiles([])
    setSelectedTileIds([])
    setDrag(null)
    setCheckFeedback(null)
    setExpandAnswer('')
  }, [])

  /** Pozice levého horního rohu průhledného náhledu při tahu ze zásobníku (viewport). */
  const [bankGhostPos, setBankGhostPos] = useState<{
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
  /** Hlavní menu: 3 záložky jako v geometrii (kategorie | volné plátno | nápověda). */
  const [menuView, setMenuView] = useState<
    'practice' | 'freeCanvas' | 'help'
  >('practice')

  /** Režim „Volné plátno“ — chrome jako geometry-app (FreeGeometryEditor). */
  const [freeZoom, setFreeZoom] = useState(FREE_ZOOM_DEFAULT)
  /** Kamera (Figma-like): posun světa v px, zoom se aplikuje zleva shora. */
  const [freePan, setFreePan] = useState({ x: 0, y: 0 })
  const freePanRef = useRef(freePan)
  const [freeDark, setFreeDark] = useState(false)
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
  /** Zvýrazněné hrany při přichycení (souřadnice vnitřního plátna). */
  const [freeEdgeSnapGuides, setFreeEdgeSnapGuides] = useState<
    FreeEdgeSnapGuide[]
  >([])
  /** Pozice znaku „=“ (fixed px) — střed výřezu workspace + střed sloupce rovnítka. */
  const [freeEqMarkScreenPos, setFreeEqMarkScreenPos] = useState<{
    left: number
    top: number
  } | null>(null)
  /** Volné plátno — posun (ruka) vs. výběr a úpravy dlaždic. */
  const [freeCanvasTool, setFreeCanvasTool] = useState<
    'move' | 'select' | 'erase'
  >('select')
  const freeCanvasToolRef = useRef(freeCanvasTool)
  freeCanvasToolRef.current = freeCanvasTool
  const freePanCleanupRef = useRef<(() => void) | null>(null)
  const freeZoomRef = useRef(freeZoom)
  const freeRecordingRef = useRef(false)
  freeZoomRef.current = freeZoom
  freePanRef.current = freePan
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
  const tileDragArmCleanupRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const factorInput1Ref = useRef<HTMLInputElement>(null)
  const factorInput2Ref = useRef<HTMLInputElement>(null)
  /** Po vstupu na volné plátno jednou vycentrovat kameru na střed světa. */
  const freeCanvasCenteredOnceRef = useRef(false)
  const commitFreeZoomRef = useRef<
    (z: number, focal?: { x: number; y: number } | null) => void
  >(() => {})
  /** Alias kvůli starým odkazům / rozbitému HMR (stejný objekt jako commitFreeZoomRef). */
  const applyFreeZoomRef = commitFreeZoomRef

  useEffect(() => {
    setShowControlsHelp(false)
  }, [route])

  const prevRouteForMenuRef = useRef(route)
  useEffect(() => {
    if (route === 'menu' && prevRouteForMenuRef.current !== 'menu') {
      setMenuView('practice')
    }
    prevRouteForMenuRef.current = route
  }, [route])

  useEffect(() => {
    if (route !== 'equation') setEquationLevelPickOpen(false)
  }, [route])

  useEffect(() => {
    if (!equationLevelPickOpen || route !== 'equation') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEquationLevelPickOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [equationLevelPickOpen, route])

  useEffect(() => {
    if (route !== 'simplify') {
      setSimplifyLevelPickOpen(false)
      setSimplifyCalculatorOpen(false)
    }
    if (route !== 'expand') {
      setExpandLevelPickOpen(false)
      setExpandCalculatorOpen(false)
    }
    if (route !== 'factor') {
      setFactorLevelPickOpen(false)
      setFactorCalculatorOpen(false)
    }
  }, [route])

  useEffect(() => {
    if (!simplifyLevelPickOpen || route !== 'simplify') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSimplifyLevelPickOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [simplifyLevelPickOpen, route])

  useEffect(() => {
    if (!expandLevelPickOpen || route !== 'expand') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandLevelPickOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandLevelPickOpen, route])

  useEffect(() => {
    if (!factorLevelPickOpen || route !== 'factor') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFactorLevelPickOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [factorLevelPickOpen, route])

  useEffect(() => {
    if (!isFreeGeometryRoute(route)) setFreeEqualsMode(false)
  }, [route])

  /** Rovnice: rozdělení plochy rovnítkem je vždy zapnuté a nejde vypnout. */
  useLayoutEffect(() => {
    if (route === 'equation') setFreeEqualsMode(true)
  }, [route])

  useEffect(() => {
    if (isFreeGeometryRoute(route)) return
    freeLassoCleanupRef.current?.()
    freeLassoCleanupRef.current = null
    setLassoPreview(null)
  }, [route])

  useEffect(() => {
    if (!isFreeGeometryRoute(route)) {
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
    setFreeZoom(FREE_ZOOM_DEFAULT)
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
    if (!el || !isFreeGeometryRoute(route)) return
    let raf: number | null = null
    let panAccumX = 0
    let panAccumY = 0
    /** Safari trackpad pinch — WebKit gesture* místo wheel+Ctrl; během gesta ignorujeme wheel zoom. */
    let gesturePinchActive = false
    let gestureZoomAtStart = 1

    const flushPan = () => {
      raf = null
      if (panAccumX === 0 && panAccumY === 0) return
      const dx = panAccumX
      const dy = panAccumY
      panAccumX = 0
      panAccumY = 0
      setFreePan((p) => ({ x: p.x - dx, y: p.y - dy }))
    }

    const applyWheelZoom = (e: WheelEvent, ndy: number) => {
      const d = Math.max(
        -FREE_WHEEL_ZOOM_DELTA_CAP,
        Math.min(FREE_WHEEL_ZOOM_DELTA_CAP, ndy)
      )
      const z = freeZoomRef.current
      const next = clampFreeZoom(
        z * Math.exp(-d * FREE_WHEEL_ZOOM_EXP_SENSITIVITY)
      )
      if (Math.abs(next - z) >= 1e-9) {
        applyFreeZoomRef.current(next, { x: e.clientX, y: e.clientY })
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { x: ndx, y: ndy } = freeWheelNormalizeDelta(e)
      /*
       * Chrome/Edge/Firefox (Mac): pinch = wheel + ctrlKey.
       * Safari: pinch často jen gesturechange; wheel může chybět nebo být slabý — viz níže.
       * Zoom řešíme hned na každou událost (ne až v jednom RAF), ať trackpad „žije“.
       */
      const zoomChord = e.ctrlKey || e.metaKey
      if (zoomChord && !gesturePinchActive) {
        applyWheelZoom(e, ndy)
        return
      }
      if (!zoomChord) {
        panAccumX += ndx
        panAccumY += ndy
        if (raf === null) raf = requestAnimationFrame(flushPan)
      }
    }

    type WebKitGestureEvent = Event & {
      scale: number
      clientX: number
      clientY: number }

    const onGestureStart = (ev: Event) => {
      ev.preventDefault()
      gesturePinchActive = true
      gestureZoomAtStart = freeZoomRef.current
    }
    const onGestureChange = (ev: Event) => {
      ev.preventDefault()
      const g = ev as WebKitGestureEvent
      const next = clampFreeZoom(gestureZoomAtStart * g.scale)
      applyFreeZoomRef.current(next, { x: g.clientX, y: g.clientY })
    }
    const onGestureEnd = (ev: Event) => {
      ev.preventDefault()
      gesturePinchActive = false
    }

    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    el.addEventListener('gesturestart', onGestureStart, { passive: false })
    el.addEventListener('gesturechange', onGestureChange, { passive: false })
    el.addEventListener('gestureend', onGestureEnd, { passive: false })

    return () => {
      el.removeEventListener('wheel', onWheel, true)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [route])

  useEffect(() => {
    if (!drag || !isFreeGeometryRoute(route)) {
      setFreeGridDropPreview(null)
      setFreeEdgeSnapGuides([])
    }
  }, [drag, route])

  const recordFreeTilesMutation = useCallback(
    (prev: PlacedTile[], next: PlacedTile[]) => {
      if (prev === next || tilesStateEqual(prev, next)) return
      if (
        !isFreeGeometryRoute(routeRef.current) ||
        applyingFreeHistoryRef.current
      )
        return
      freeHistoryPastRef.current.push(prev.map((t) => ({ ...t })))
      if (freeHistoryPastRef.current.length > FREE_TILE_HISTORY_LIMIT) {
        freeHistoryPastRef.current.shift()
      }
      freeHistoryFutureRef.current = []
    },
    []
  )

  const onUndoFree = useCallback(() => {
    if (!isFreeGeometryRoute(routeRef.current)) return
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
    if (!isFreeGeometryRoute(routeRef.current)) return
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
    if (!isFreeGeometryRoute(route)) return
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
      if (isFreeGeometryRoute(route) && prev.length > 0) {
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
    setSimplifyAnswer('')
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

  const tileGeom: TileGeomMode = isFreeGeometry ? 'freeGrid' : 'algebra'
  const { gw, gh: ghTiles } = useMemo(
    () => resizeToFitTiles(tiles, tileGeom),
    [tiles, tileGeom]
  )
  /**
   * Logická velikost světa (bez zoomu). Na volném plátně je navíc rezerva pro posun
   * jako ve Figmě (žádný nativní scroll — jen translate + scale na kameře).
   */
  const innerW =
    Math.max(gw, viewSize.w) +
    (isFreeGeometry
      ? FREE_WORK_SURFACE_PADDING_PX + FREE_CANVAS_PAN_ROOM_PX
      : 0)
  const innerH =
    Math.max(ghTiles, viewSize.h) +
    (isFreeGeometry
      ? FREE_WORK_SURFACE_PADDING_PX + FREE_CANVAS_PAN_ROOM_PX
      : 0)
  const innerWRef = useRef(innerW)
  const innerHRef = useRef(innerH)
  innerWRef.current = innerW
  innerHRef.current = innerH

  const viewSizeRef = useRef(viewSize)
  viewSizeRef.current = viewSize
  const viewSizeForFreePanRef = useRef(viewSize)

  const commitFreeZoom = useCallback(
    (raw: number, focalClient?: { x: number; y: number } | null) => {
      const z = clampFreeZoom(raw)
      const zPrev = freeZoomRef.current
      if (Math.abs(z - zPrev) < 1e-9) return
      if (isFreeGeometryRoute(route)) {
        const el = scrollRef.current
        const pan = freePanRef.current
        if (el) {
          const rect = el.getBoundingClientRect()
          const vx = focalClient
            ? focalClient.x - rect.left
            : el.clientWidth / 2
          const vy = focalClient
            ? focalClient.y - rect.top
            : el.clientHeight / 2
          const wx = (vx - pan.x) / zPrev
          const wy = (vy - pan.y) / zPrev
          setFreePan({ x: vx - wx * z, y: vy - wy * z })
        }
      }
      setFreeZoom(z)
    },
    [route]
  )

  commitFreeZoomRef.current = commitFreeZoom

  const freeZoomFromChrome = useCallback(
    (z: number) => {
      const el = scrollRef.current
      if (!isFreeGeometryRoute(route) || !el) {
        commitFreeZoom(z, null)
        return
      }
      const rect = el.getBoundingClientRect()
      commitFreeZoom(z, {
        x: rect.left + el.clientWidth / 2,
        y: rect.top + el.clientHeight / 2,
      })
    },
    [route, commitFreeZoom]
  )

  useEffect(() => {
    if (!isFreeGeometryRoute(route)) {
      freeCanvasCenteredOnceRef.current = false
      setFreePan({ x: 0, y: 0 })
    } else {
      freeCanvasCenteredOnceRef.current = false
    }
  }, [route])

  /** Změna výřezu okna — posun kamery, aby zůstal střed výřezu (jako Figma). */
  useLayoutEffect(() => {
    if (!isFreeGeometryRoute(route)) {
      viewSizeForFreePanRef.current = viewSize
      return
    }
    const prev = viewSizeForFreePanRef.current
    const dW = viewSize.w - prev.w
    const dH = viewSize.h - prev.h
    if (dW !== 0 || dH !== 0) {
      setFreePan((p) => ({ x: p.x + dW / 2, y: p.y + dH / 2 }))
    }
    viewSizeForFreePanRef.current = viewSize
  }, [route, viewSize.w, viewSize.h])

  /** Při prvním zobrazení volného plátna: vycentrovat svět vůči viewportu. */
  useLayoutEffect(() => {
    if (!isFreeGeometryRoute(route)) return
    if (freeCanvasCenteredOnceRef.current) return

    const el = scrollRef.current
    if (!el) return

    const cw = el.clientWidth
    const ch = el.clientHeight
    if (cw <= 0 || ch <= 0) return

    const z = freeZoom
    /* Centrovat jen „užitečnou“ plochu (max(gw, výřez)), ne celé inner včetně rezervy
     * pro pan — jinak zmizí sloupec rovnítka a znak = při prázdném plátně. */
    const boxW = innerW - FREE_CANVAS_PAN_ROOM_PX
    const boxH = innerH - FREE_CANVAS_PAN_ROOM_PX
    setFreePan({
      x: (cw - boxW * z) / 2,
      y: (ch - boxH * z) / 2,
    })
    freeCanvasCenteredOnceRef.current = true
  }, [route, innerW, innerH, freeZoom])

  /** Levý okraj buňky mřížky uprostřed šířky plátna (sloupec „rovnítka“). */
  const freeEqBandLeft = useMemo(() => {
    if (!isFreeGeometryRoute(route)) return 0
    const G = FREE_GRID_CELL_PX
    /* Stejná šířka jako bílý „papír“ (.free-canvas-paper): max(dlaždice, výřez) + doplněk,
     * ne jen max(dlaždice, výřez) — jinak je pruh = posunutý doleva oproti středu plochy. */
    const paperW = innerW - FREE_CANVAS_PAN_ROOM_PX
    if (paperW <= G) return 0
    const left = Math.floor((paperW - G) / 2 / G) * G
    return Math.min(Math.max(0, innerW - G), left)
  }, [route, innerW])
  freeEqBandLeftRef.current = freeEqBandLeft

  const freeEqPartition = useMemo(() => {
    if (!isFreeGeometryRoute(route) || !freeEqualsMode) return null
    return partitionTilesByEqualsColumn(
      tiles,
      freeEqBandLeft,
      FREE_GRID_CELL_PX,
      'freeGrid'
    )
  }, [route, freeEqualsMode, tiles, freeEqBandLeft])

  useLayoutEffect(() => {
    if (!isFreeGeometryRoute(route) || !freeEqualsMode) {
      setFreeEqMarkScreenPos(null)
      return
    }
    const placeMark = (attempt = 0) => {
      const scrollEl = scrollRef.current
      const outer = boardRef.current
      if (!scrollEl || !outer) {
        setFreeEqMarkScreenPos(null)
        return
      }
      const sr = scrollEl.getBoundingClientRect()
      if (sr.width < 2 || sr.height < 2) {
        if (attempt < 12) requestAnimationFrame(() => placeMark(attempt + 1))
        return
      }
      const or = outer.getBoundingClientRect()
      const cx =
        or.left +
        freePan.x +
        freeEqBandLeft * freeZoom +
        (FREE_GRID_CELL_PX * freeZoom) / 2
      const cy = sr.top + sr.height / 2
      setFreeEqMarkScreenPos({ left: cx, top: cy })
    }
    placeMark(0)
  }, [
    route,
    freeEqualsMode,
    freePan.x,
    freePan.y,
    freeZoom,
    freeEqBandLeft,
    viewSize.w,
    viewSize.h,
  ])

  const tryPlaceFromBankAt = useCallback(
    (key: BankKey, px: number, py: number) => {
      const { kind, negative } = parseBankKey(key)
      const baseId = crypto.randomUUID()

      setTiles((prev) => {
        let rawX = boardClamp(px)
        let rawY = boardClamp(py)
        if (isFreeGeometryRoute(routeRef.current)) {
          const tmp: PlacedTile = {
            id: baseId,
            kind,
            negative,
            rot: 0,
            x: rawX,
            y: rawY,
          }
          const snapped = snapFreeMovingGroup({
            staticTiles: prev,
            moving: [{ tile: tmp, x: rawX, y: rawY }],
            innerW: innerWRef.current,
            innerH: innerHRef.current,
            threshold: freeSnapThresholdInner(freeZoomRef.current),
          })
          rawX = boardClamp(rawX + snapped.dx)
          rawY = boardClamp(rawY + snapped.dy)
        }
        const draft: PlacedTile = {
          id: baseId,
          kind,
          negative,
          rot: 0,
          x: rawX,
          y: rawY,
        }
        const candidate: PlacedTile = draft
        const geom: TileGeomMode = isFreeGeometryRoute(routeRef.current)
          ? 'freeGrid'
          : 'algebra'
        const pair = prev.find((o) =>
          tilesAreZeroPairOverlapping(candidate, o, geom)
        )
        if (pair) {
          if (isFreeGeometryRoute(routeRef.current)) {
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
      const rawX = mode === 'liveDrag' ? px : boardClamp(px)
      const rawY = mode === 'liveDrag' ? py : boardClamp(py)
      setTiles((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx < 0) return prev
        const t = prev[idx]
        if (mode === 'liveDrag') {
          const next: PlacedTile = { ...t, x: rawX, y: rawY }
          const copy = [...prev]
          copy[idx] = next
          return copy
        }
        const next: PlacedTile = { ...t, x: rawX, y: rawY }
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
          const rawX = x
          const rawY = y
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
    (source: PlacedTile, side: DuplicateFromSide) => {
      if (drag) return
      const r = routeRef.current
      if (r === 'menu') return
      const isFree = isFreeGeometryRoute(r)
      setTiles((prev) => {
        const draft = tryPlaceDuplicate(source, prev, isFree, side)
        if (!draft) return prev
        const next = [...prev, draft]
        recordFreeTilesMutation(prev, next)
        queueMicrotask(() => setSelectedTileIds([draft.id]))
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
      const isFree = isFreeGeometryRoute(r)
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
      tileDragArmCleanupRef.current?.()
      tileDragArmCleanupRef.current = null
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
      const dropOnBankChrome = isFreeGeometryRoute(rNow)
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

        if (isFreeGeometryRoute(rNow) && groupIds.length > 1) {
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

            const working = eliminateAllZeroPairs(prev, 'freeGrid')
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

        const geom: TileGeomMode = isFreeGeometryRoute(rNow)
          ? 'freeGrid'
          : 'algebra'
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
            if (isFreeGeometryRoute(rNow)) {
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
          const settled: PlacedTile = {
            ...t,
            x: boardClamp(t.x),
            y: boardClamp(t.y),
          }
          const toPlace = settled
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

        if (isFreeGeometryRoute(rNow)) {
          let overPill = false
          outer.ownerDocument
            .querySelectorAll('.bank-sidebar--free-tools')
            .forEach((pill) => {
              const pr = pill.getBoundingClientRect()
              if (
                cx >= pr.left &&
                cx <= pr.right &&
                cy >= pr.top &&
                cy <= pr.bottom
              ) {
                overPill = true
              }
            })
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
          const px = boardClamp((cx - ro.left) - w / 2)
          const py = boardClamp((cy - ro.top) - h / 2)
          tryPlaceFromBankAt(active.key, px, py)
        }
      }
    },
    [tryPlaceFromBankAt, recordFreeTilesMutation]
  )

  const updateFreeGridPreview = useCallback(
    (clientX: number, clientY: number, key: BankKey, tileW: number, tileH: number) => {
      if (!isFreeGeometryRoute(routeRef.current)) {
        setFreeGridDropPreview(null)
        setFreeEdgeSnapGuides([])
        return
      }
      const outer = boardRef.current
      const inner = freeBoardInnerRef.current
      if (!outer || !inner) {
        setFreeGridDropPreview(null)
        setFreeEdgeSnapGuides([])
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
        setFreeEdgeSnapGuides([])
        return
      }
      const hit = document.elementFromPoint(clientX, clientY)
      if (hit?.closest(FREE_BANK_CHROME_SEL)) {
        setFreeGridDropPreview(null)
        setFreeEdgeSnapGuides([])
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
      const { kind, negative } = parseBankKey(key)
      const stub: PlacedTile = {
        id: '__bank_preview__',
        kind,
        negative,
        rot: 0,
        x: sx,
        y: sy,
      }
      const snapped = snapFreeMovingGroup({
        staticTiles: tilesRef.current,
        moving: [{ tile: stub, x: sx, y: sy }],
        innerW: innerWRef.current,
        innerH: innerHRef.current,
        threshold: freeSnapThresholdInner(freeZoomRef.current),
      })
      setFreeGridDropPreview(null)
      setFreeEdgeSnapGuides(snapped.guides)
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
          if (isFreeGeometryRoute(routeRef.current)) {
            updateFreeGridPreview(ev.clientX, ev.clientY, d.key, d.w, d.h)
          }
          return
        }
        const memberKeys = Object.keys(d.memberOrigins)
        const isGroupDrag = memberKeys.length > 1
        const z = isFreeGeometryRoute(routeRef.current)
          ? freeZoomRef.current
          : 1
        const leaderO = d.memberOrigins[d.id]
        if (!leaderO) return
        if (isFreeGeometryRoute(routeRef.current)) {
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
          const nx = boardClamp(rawNx)
          const ny = boardClamp(rawNy)
          const dx = nx - leaderO.gx
          const dy = ny - leaderO.gy
          const draggingIds = new Set(memberKeys)
          const staticTiles = tilesRef.current.filter(
            (t) => !draggingIds.has(t.id)
          )
          const moving = memberKeys
            .map((mid) => {
              const t = tilesRef.current.find((x) => x.id === mid)
              const o = d.memberOrigins[mid]
              if (!t || !o) return null
              return {
                tile: t,
                x: boardClamp(o.gx + dx),
                y: boardClamp(o.gy + dy),
              }
            })
            .filter((m): m is { tile: PlacedTile; x: number; y: number } => m !== null)
          const snap = snapFreeMovingGroup({
            staticTiles,
            moving,
            innerW: innerWRef.current,
            innerH: innerHRef.current,
            threshold: freeSnapThresholdInner(freeZoomRef.current),
          })
          const updates = memberKeys.map((mid) => {
            const o = d.memberOrigins[mid]
            if (!o) return null
            return {
              id: mid,
              x: boardClamp(o.gx + dx + snap.dx),
              y: boardClamp(o.gy + dy + snap.dy),
            }
          }).filter((u): u is { id: string; x: number; y: number } => u !== null)
          moveTilesLiveBatch(updates)
          setFreeEdgeSnapGuides(snap.guides)
        } else {
          const nx = leaderO.gx + (ev.clientX - d.startPx) / z
          const ny = leaderO.gy + (ev.clientY - d.startPy) / z
          if (isGroupDrag) {
            const dx = nx - leaderO.gx
            const dy = ny - leaderO.gy
            const updates = memberKeys.map((mid) => {
              const o = d.memberOrigins[mid]
              if (!o) return null
              return {
                id: mid,
                x: boardClamp(o.gx + dx),
                y: boardClamp(o.gy + dy),
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
        setFreeEdgeSnapGuides([])
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

  const armTileDragSession = useCallback(
    (d: DragTile, pointerId: number, clientX: number, clientY: number) => {
      tileDragArmCleanupRef.current?.()
      const startPx = clientX
      const startPy = clientY
      let started = false
      const armRemove = () => {
        window.removeEventListener('pointermove', onArmMove)
        window.removeEventListener('pointerup', onArmUp, true)
        window.removeEventListener('pointercancel', onArmUp, true)
        tileDragArmCleanupRef.current = null
      }
      const beginDrag = () => {
        if (started) return
        started = true
        armRemove()
        setDrag(d)
        attachGlobalDragListeners(d, pointerId)
        if (isFreeGeometryRoute(routeRef.current)) {
          setFreeEdgeSnapGuides([])
          setFreeGridDropPreview(null)
        }
      }
      const onArmMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const dist = Math.hypot(ev.clientX - startPx, ev.clientY - startPy)
        if (dist >= TILE_DRAG_START_THRESHOLD_PX) {
          beginDrag()
        }
      }
      const onArmUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        armRemove()
      }
      tileDragArmCleanupRef.current = armRemove
      window.addEventListener('pointermove', onArmMove)
      window.addEventListener('pointerup', onArmUp, true)
      window.addEventListener('pointercancel', onArmUp, true)
    },
    [attachGlobalDragListeners]
  )

  const onBankPointerDown = (key: BankKey, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const { kind } = parseBankKey(key)
    const { w, h } = isFreeGeometryRoute(route)
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
    if (isFreeGeometryRoute(route)) {
      updateFreeGridPreview(e.clientX, e.clientY, key, w, h)
    }
  }

  const renderFreeRailBankCells = (): ReactNode =>
    SOURCE_META.map(({ kind, negative, caption }) => {
      const key = bankKey(kind, negative)
      const template: PlacedTile = {
        id: `src-${key}`,
        kind,
        negative,
        rot: 0,
        x: 0,
        y: 0,
      }
      const freeFoot = tileFootprintFreeGrid(kind, 0)
      const railUnderhangPx =
        ALGEBRA_TILE_FRAME_UNDERLAY_SHIFT_PX * FREE_BANK_RAIL_SCALE
      const preview = (
        <TileView
          tile={template}
          layout="static"
          selected={false}
          dragging={false}
          nonInteractive
          geometry="freeGrid"
          onPointerDown={() => {}}
          onDoubleClick={() => {}}
        />
      )
      return (
        <div key={key} className="bank-cell">
          <div
            className="bank-cell__drop bank-cell__drop--free-rail"
            style={{
              width: Math.round(freeFoot.w * FREE_BANK_RAIL_SCALE),
              height: Math.round(
                freeFoot.h * FREE_BANK_RAIL_SCALE + railUnderhangPx
              ),
            }}
            onPointerDown={(e) => onBankPointerDown(key, e)}
            title={caption}
            aria-label={`Přetáhnout dlaždici ${caption}`}
          >
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
          </div>
        </div>
      )
    })

  const renderAlgebraBankCells = (): ReactNode =>
    SOURCE_META.map(({ kind, negative, caption }) => {
      const key = bankKey(kind, negative)
      const template: PlacedTile = {
        id: `src-${key}`,
        kind,
        negative,
        rot: 0,
        x: 0,
        y: 0,
      }
      const preview = (
        <TileView
          tile={template}
          layout="static"
          selected={false}
          dragging={false}
          nonInteractive
          geometry="algebra"
          onPointerDown={() => {}}
          onDoubleClick={() => {}}
        />
      )
      return (
        <div key={key} className="bank-cell">
          <div
            className="bank-cell__drop"
            onPointerDown={(e) => onBankPointerDown(key, e)}
            title={caption}
            aria-label={`Přetáhnout dlaždici ${caption}`}
          >
            {preview}
          </div>
        </div>
      )
    })

  const eraseFreeTile = useCallback(
    (tile: PlacedTile) => {
      if (drag) return
      if (!isFreeGeometryRoute(routeRef.current)) return
      setTiles((prev) => {
        const t = prev.find((x) => x.id === tile.id)
        if (!t) return prev
        const others = prev.filter((x) => x.id !== tile.id)
        const pair = others.find((o) =>
          tilesAreZeroPairOverlapping(t, o, 'freeGrid')
        )
        let next: PlacedTile[]
        if (pair) {
          queueMicrotask(() =>
            setFreeZeroPairVaporFx({
              tileA: { ...t },
              tileB: { ...pair },
            })
          )
          next = prev.filter((p) => p.id !== tile.id && p.id !== pair.id)
        } else {
          next = others
        }
        if (tilesStateEqual(prev, next)) return prev
        recordFreeTilesMutation(prev, next)
        queueMicrotask(() =>
          setSelectedTileIds((sel) =>
            sel.filter((sid) => sid !== tile.id && (!pair || sid !== pair.id))
          )
        )
        return next
      })
    },
    [drag, recordFreeTilesMutation]
  )

  const onTilePointerDown = (tile: PlacedTile, e: React.PointerEvent) => {
    if (
      isFreeGeometryRoute(routeRef.current) &&
      freeCanvasToolRef.current === 'move'
    ) {
      return
    }
    if (
      isFreeGeometryRoute(routeRef.current) &&
      freeCanvasToolRef.current === 'erase'
    ) {
      e.stopPropagation()
      if (e.button !== 0) return
      e.preventDefault()
      eraseFreeTile(tile)
      return
    }
    e.stopPropagation()
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const br = el.getBoundingClientRect()
    const grabOffX = e.clientX - br.left
    const grabOffY = e.clientY - br.top

    const isFree = isFreeGeometryRoute(routeRef.current)
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
    armTileDragSession(d, e.pointerId, e.clientX, e.clientY)
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
        const geom: TileGeomMode = isFreeGeometryRoute(route)
          ? 'freeGrid'
          : 'algebra'
        const pair = others.find((o) =>
          tilesAreZeroPairOverlapping(flipped, o, geom)
        )
        let next: PlacedTile[]
        if (pair) {
          if (isFreeGeometryRoute(route)) {
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
        } else if (isFreeGeometryRoute(route)) {
          const adjusted: PlacedTile = { ...flipped }
          if (overlapsOthers([...others, adjusted], adjusted, 'freeGrid'))
            return prev
          next = prev.map((x) => (x.id === tile.id ? adjusted : x))
        } else {
          const adjusted: PlacedTile = {
            ...flipped,
            x: boardClamp(flipped.x),
            y: boardClamp(flipped.y),
          }
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
      if (isFreeGeometryRoute(route)) {
        const turnedTile: PlacedTile = { ...turned }
        if (overlapsOthers([...others, turnedTile], turnedTile, 'freeGrid'))
          return prev
        next = prev.map((x) => (x.id === tile.id ? turnedTile : x))
      } else {
        const turnedMag: PlacedTile = {
          ...turned,
          x: boardClamp(turned.x),
          y: boardClamp(turned.y),
        }
        if (overlapsOthers([...others, turnedMag], turnedMag)) return prev
        next = prev.map((x) => (x.id === tile.id ? turnedMag : x))
      }
      if (tilesStateEqual(prev, next)) return prev
      recordFreeTilesMutation(prev, next)
      return next
    })
  }

  const onBoardClick = (e: React.MouseEvent) => {
    if (suppressNextBoardClearRef.current) {
      suppressNextBoardClearRef.current = false
      return
    }
    const t = e.target as HTMLElement | null
    if (t?.closest('.algebra-tile') || t?.closest('.free-selection-chrome')) {
      return
    }
    setSelectedTileIds([])
  }

  const flipTileSignGroup = useCallback(
    (ids: string[]) => {
      if (drag || ids.length === 0) return
      setTiles((prev) => {
        const isFree = isFreeGeometryRoute(routeRef.current)
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
      if (
        !isFreeGeometryRoute(routeRef.current) ||
        freeCanvasToolRef.current !== 'select'
      ) {
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
    if (!isFreeGeometry || selectedTileIds.length <= 1) return null
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
  }, [isFreeGeometry, tiles, selectedTileIds])

  const onFreeWorkspacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (
        !isFreeGeometryRoute(routeRef.current) ||
        freeCanvasToolRef.current !== 'move'
      ) {
        return
      }
      if (e.button !== 0) return
      const host = e.currentTarget as HTMLElement
      e.preventDefault()
      try {
        host.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      const state = {
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        panX0: freePanRef.current.x,
        panY0: freePanRef.current.y,
      }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return
        setFreePan({
          x: state.panX0 + (ev.clientX - state.x0),
          y: state.panY0 + (ev.clientY - state.y0),
        })
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return
        try {
          host.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
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
    if (!isQuadraticFullyExpandedSingleTerms(simplifyAnswer)) {
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

  const renderInlineAnswerFeedback = () => {
    if (!checkFeedback) return null
    return (
      <div
        role="status"
        className={`equation-answer-eval${
          checkFeedback === 'success'
            ? ' equation-answer-eval--success'
            : ' equation-answer-eval--fail'
        }${freeDark ? ' equation-answer-eval--dark' : ''}`}
      >
        {checkFeedback === 'success' ? (
          <>
            <span className="equation-answer-eval__title">Správně</span>
            <span className="equation-answer-eval__smile" aria-hidden>
              :)
            </span>
          </>
        ) : (
          <>
            <span className="equation-answer-eval__title">Bohužel</span>
            <span className="equation-answer-eval__smile" aria-hidden>
              :(
            </span>
          </>
        )}
      </div>
    )
  }

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

  if (route === 'menu') {
    const enterFreeCanvas = () => {
      setRoute('free')
      setTiles([])
      setSelectedTileIds([])
      setDrag(null)
      setCheckFeedback(null)
    }

    const practiceCards: {
      tone: number
      title: string
      Icon: LucideIcon
      onClick: () => void
    }[] = [
      {
        tone: 0,
        title: 'Rovnice',
        Icon: Equal,
        onClick: () => enterEquationMode('basic'),
      },
      {
        tone: 1,
        title: 'Zjednodušování',
        Icon: Minimize2,
        onClick: () => enterSimplifyMode('basic'),
      },
      {
        tone: 2,
        title: 'Roznásobování',
        Icon: Expand,
        onClick: () => enterExpandMode('monomial', 'basic'),
      },
      {
        tone: 3,
        title: 'Rozklad na součin',
        Icon: SplitSquareHorizontal,
        onClick: () => {
          setRoute('factor')
          enterFactorMode('basic')
        },
      },
    ]

    const sectionTitle =
      menuView === 'practice'
        ? 'Úlohy'
        : menuView === 'freeCanvas'
          ? 'Volné plátno'
          : 'Nápověda'

    return (
      <div className="app app--fill main-menu main-menu--geo">
        <header className="main-menu__masthead">
          <h1 className="main-menu__brand">
            Algebraické dlaždice, úlohy a cvičení
          </h1>
          <nav
            className="main-menu__tabs"
            role="tablist"
            aria-label="Hlavní nabídka"
          >
            <button
              type="button"
              role="tab"
              aria-selected={menuView === 'practice'}
              className={`main-menu__tab${menuView === 'practice' ? ' main-menu__tab--active' : ''}`}
              onClick={() => setMenuView('practice')}
            >
              Úlohy
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={menuView === 'freeCanvas'}
              className={`main-menu__tab${menuView === 'freeCanvas' ? ' main-menu__tab--active' : ''}`}
              onClick={() => setMenuView('freeCanvas')}
            >
              Volné plátno
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={menuView === 'help'}
              className={`main-menu__tab${menuView === 'help' ? ' main-menu__tab--active' : ''}`}
              onClick={() => setMenuView('help')}
            >
              Nápověda
            </button>
          </nav>
        </header>
        <div className="main-menu__body">
          {menuView === 'help' ? (
            <>
              <h2 className="main-menu__section-title">{sectionTitle}</h2>
              <div className="main-menu__help-panel-wrap">
                <ControlsHelpPanel route="menu" />
              </div>
            </>
          ) : (
            <>
              <h2 className="main-menu__section-title">{sectionTitle}</h2>
              {menuView === 'practice' ? (
                <div
                  className="main-menu__grid main-menu__grid--geo main-menu__grid--practice"
                  role="navigation"
                  aria-label="Cvičební režimy"
                >
                  {practiceCards.map(({ tone, title, Icon, onClick }) => (
                    <button
                      key={title}
                      type="button"
                      className={`main-menu__card main-menu__card--geo main-menu__card--tone-${tone}`}
                      onClick={onClick}
                    >
                      <span className="main-menu__card-visual" aria-hidden>
                        <Icon
                          className="main-menu__card-icon"
                          size={52}
                          strokeWidth={1.35}
                        />
                      </span>
                      <span className="main-menu__card-footer">
                        <span className="main-menu__card-title">{title}</span>
                        <ChevronRight
                          className="main-menu__card-arrow"
                          size={22}
                          strokeWidth={2}
                          aria-hidden
                        />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div
                  className="main-menu__free-single"
                  role="navigation"
                  aria-label="Volné plátno"
                >
                  <button
                    type="button"
                    className="main-menu__card main-menu__card--geo main-menu__card--tone-free"
                    onClick={enterFreeCanvas}
                  >
                    <span className="main-menu__card-visual" aria-hidden>
                      <LayoutGrid
                        className="main-menu__card-icon"
                        size={56}
                        strokeWidth={1.35}
                      />
                    </span>
                    <span className="main-menu__card-footer">
                      <span className="main-menu__card-title">
                        Otevřít volné plátno
                      </span>
                      <ChevronRight
                        className="main-menu__card-arrow"
                        size={22}
                        strokeWidth={2}
                        aria-hidden
                      />
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`app app--fill${isFreeGeometry ? ' app--free-geometry' : ''}${isFreeGeometry && freeDark ? ' app--free-dark' : ''}${route === 'free' && (freeRecordingShowPlayer || freeRecordingShowEditor) ? ' app--free-playback' : ''}${route === 'free' && freeRecordingShowPlayer ? ' app--free-rec-player-active' : ''}`}
    >
      {!isFreeGeometry ? (
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
        className={`app__body${isFreeGeometry ? ' app__body--free-rail' : ''}`}
      >
        <aside
          className={`bank-sidebar${isFreeGeometry ? ' bank-sidebar--free-tools' : ' panel'}`}
          data-bank-drop
          draggable={isFreeGeometry ? false : undefined}
          onDragStart={
            isFreeGeometry
              ? (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }
              : undefined
          }
        >
          {isFreeGeometry ? (
            <>
              <button
                type="button"
                className="bank-rail__back"
                aria-label="Hlavní menu"
                title="Zpět do menu"
                onClick={() => {
                  setRoute('menu')
                  setCheckFeedback(null)
                  setDrag(null)
                }}
              >
                <svg
                  className="bank-rail__back-icon"
                  width="26"
                  height="26"
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
              </button>
              <div
                className="bank-rail__sep bank-rail__sep--vertical"
                aria-hidden="true"
              />
              <div
                className="bank-rail__tools"
                role="toolbar"
                aria-label="Nástroje plátna"
                onPointerDown={(e) => e.stopPropagation()}
              >
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
              </div>
              <div
                className="bank-rail__sep bank-rail__sep--vertical"
                aria-hidden="true"
              />
            </>
          ) : (
            <button
              type="button"
              className="btn secondary main-menu-back"
              onClick={() => {
                setRoute('menu')
                setCheckFeedback(null)
                setDrag(null)
              }}
            >
              ← Hlavní menu
            </button>
          )}

          {checkFeedback &&
          !ROUTES_WITH_INLINE_ANSWER_FEEDBACK.includes(route) ? (
            <p
              className={`feedback feedback--sidebar${checkFeedback === 'success' ? ' feedback--success' : ' feedback--fail'}`}
              role="status"
            >
              {checkFeedback === 'success' ? 'Správně :)' : 'Bohužel :('}
            </p>
          ) : null}
          <h2
            className={`bank-heading${isFreeGeometry ? ' bank-heading--rail bank-heading--sr-only' : ''}`}
          >
            Zásobník dlaždic
          </h2>
          <div
            className={`bank-grid${isFreeGeometry ? ' bank-grid--rail' : ''}`}
          >
            {isFreeGeometry
              ? renderFreeRailBankCells()
              : renderAlgebraBankCells()}
          </div>

          {isFreeGeometry ? (
            <div
              className="bank-rail__sep bank-rail__sep--vertical"
              aria-hidden="true"
            />
          ) : null}
          <div className="bank-actions">
            {isFreeGeometry ? (
              <button
                type="button"
                className={`bank-rail__tool${freeCanvasTool === 'erase' ? ' bank-rail__tool--active' : ''}`}
                aria-pressed={freeCanvasTool === 'erase'}
                aria-label="Guma — smazat dlaždici klepnutím"
                title="Guma — smazat dlaždici klepnutím"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setFreeCanvasTool('erase')}
              >
                <Eraser className="bank-rail__tool-icon" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              className={
                isFreeGeometry ? 'bank-rail__clear' : 'btn secondary'
              }
              title={
                isFreeGeometry ? 'Vyčistit plochu a vstupy' : undefined
              }
              aria-label={
                isFreeGeometry ? 'Vyčistit plochu a vstupy' : undefined
              }
              onClick={() => applyTask()}
              onTouchEnd={
                isFreeGeometry
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      applyTask()
                    }
                  : undefined
              }
            >
              {isFreeGeometry ? (
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
          className={`workspace-column${isFreeGeometry ? ' workspace-column--free-geo' : ''}`}
        >
          {route === 'free' ? (
            <>
              <FreeCanvasTopBar
                zoom={freeZoom}
                onZoomChange={freeZoomFromChrome}
                darkMode={freeDark}
                onDarkModeChange={setFreeDark}
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
                  canUndo={freeHistoryPastRef.current.length > 0}
                  canRedo={freeHistoryFutureRef.current.length > 0}
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
          ) : route === 'equation' ? (
            <>
              <FreeCanvasTopBar
                zoom={freeZoom}
                onZoomChange={freeZoomFromChrome}
                darkMode={freeDark}
                onDarkModeChange={setFreeDark}
                equalsMode
                onEqualsModeChange={() => {}}
              />
              <div
                className={`equation-free-task-banner${freeDark ? ' equation-free-task-banner--dark' : ''}`}
                aria-live="polite"
                aria-label={`Úloha: ${formatEquationDisplay(linearTask)}`}
              >
                <MathText text={formatEquationDisplay(linearTask)} />
              </div>
              <div
                className={`equation-free-answer-banner equation-free-answer-banner--answer-route${freeDark ? ' equation-free-answer-banner--dark' : ''}`}
                role="group"
                aria-label="Zapište hodnotu x"
              >
                {renderInlineAnswerFeedback()}
                <div className="equation-free-answer-banner__main-row">
                  <span className="equation-free-answer-banner__prefix">
                    <MathText text="x" />
                    <span
                      className="equation-free-answer-banner__equals"
                      aria-hidden
                    >
                      =
                    </span>
                  </span>
                  <input
                    className="equation-free-answer-banner__input"
                    type="text"
                    inputMode="decimal"
                    value={equationAnswer}
                    onChange={(e) => setEquationAnswer(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Hodnota x"
                  />
                  <button
                    type="button"
                    className="check-icon-button"
                    onClick={checkEquation}
                    aria-label="Zkontrolovat hodnotu x"
                    title="Zkontrolovat x"
                  >
                    <Check
                      className="check-icon-button__icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    className="equation-free-answer-banner__refresh"
                    onClick={() => setEquationLevelPickOpen(true)}
                    aria-label="Nová náhodná úloha — zvolit obtížnost"
                    title="Nová náhodná úloha"
                  >
                    <RefreshCw
                      className="equation-free-answer-banner__refresh-icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
              <FreeCanvasRightBar
                darkMode={freeDark}
                canUndo={freeHistoryPastRef.current.length > 0}
                canRedo={freeHistoryFutureRef.current.length > 0}
                onUndo={onUndoFree}
                onRedo={onRedoFree}
                isRecording={false}
                onToggleRecording={() => {}}
                showRecordingButton={false}
                notesOpen={freeShowNotes}
                onToggleNotes={() => setFreeShowNotes((o) => !o)}
                notesBadgeCount={freeSessionLog.length}
              />
              <FreeCanvasNotesPanel
                open={freeShowNotes}
                onClose={() => setFreeShowNotes(false)}
                darkMode={freeDark}
                notes={freeNotes}
                onNotesChange={setFreeNotes}
                sessionLog={freeSessionLog}
                isRecording={false}
              />
              {equationLevelPickOpen ? (
                <div
                  className={`equation-level-pick-backdrop${freeDark ? ' equation-level-pick-backdrop--dark' : ''}`}
                  role="presentation"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      setEquationLevelPickOpen(false)
                    }
                  }}
                >
                  <div
                    className="equation-level-pick"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="equation-level-pick-title"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <h2
                      id="equation-level-pick-title"
                      className="equation-level-pick__title"
                    >
                      Nová náhodná úloha
                    </h2>
                    <p className="equation-level-pick__hint">Zvolte obtížnost:</p>
                    <div className="equation-level-pick__actions">
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterEquationMode('basic')
                          setEquationLevelPickOpen(false)
                        }}
                      >
                        Základní
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterEquationMode('advanced')
                          setEquationLevelPickOpen(false)
                        }}
                      >
                        Pokročilá
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterEquationMode('master')
                          setEquationLevelPickOpen(false)
                        }}
                      >
                        Mistr
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn secondary equation-level-pick__cancel"
                      onClick={() => setEquationLevelPickOpen(false)}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : route === 'simplify' ? (
            <>
              <FreeCanvasTopBar
                zoom={freeZoom}
                onZoomChange={freeZoomFromChrome}
                darkMode={freeDark}
                onDarkModeChange={setFreeDark}
                equalsMode={freeEqualsMode}
                onEqualsModeChange={setFreeEqualsMode}
                showEqualsButton={false}
              />
              {simplifyCalculatorOpen ? (
                <div
                  className={`simplify-free-calculator-wrap${freeDark ? ' simplify-free-calculator-wrap--dark' : ''}`}
                >
                  <SimplifyCalculator
                    inputRef={simplifyInputRef}
                    value={simplifyAnswer}
                    onChange={setSimplifyAnswer}
                    darkMode={freeDark}
                  />
                </div>
              ) : null}
              <div
                className={`simplify-free-answer-banner equation-free-answer-banner equation-free-answer-banner--answer-route${freeDark ? ' simplify-free-answer-banner--dark equation-free-answer-banner--dark' : ''}`}
                role="group"
                aria-label={`Zjednodušte výraz — zadejte výsledek: ${simplifyTask.displayString}`}
              >
                {renderInlineAnswerFeedback()}
                <div className="equation-free-answer-banner__main-row simplify-free-answer-banner__main-row">
                  <span className="simplify-free-answer-banner__poly">
                    <MathText text={simplifyTask.displayString} />
                  </span>
                  <span className="equation-free-answer-banner__equals" aria-hidden>
                    =
                  </span>
                  <input
                    ref={simplifyInputRef}
                    className="factor-bracket-input simplify-free-answer-banner__input"
                    type="text"
                    inputMode="text"
                    value={simplifyAnswer}
                    onChange={(e) => setSimplifyAnswer(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Zjednodušený polynom"
                  />
                  <button
                    type="button"
                    className="check-icon-button"
                    onClick={checkSimplify}
                    aria-label="Zkontrolovat zjednodušování"
                    title="Zkontrolovat"
                  >
                    <Check
                      className="check-icon-button__icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    className={`equation-free-answer-banner__calc${simplifyCalculatorOpen ? ' equation-free-answer-banner__calc--active' : ''}`}
                    onClick={() => setSimplifyCalculatorOpen((o) => !o)}
                    aria-label={
                      simplifyCalculatorOpen
                        ? 'Skrýt kalkulačku'
                        : 'Otevřít kalkulačku'
                    }
                    aria-expanded={simplifyCalculatorOpen}
                    title="Kalkulačka"
                  >
                    <Calculator
                      className="equation-free-answer-banner__calc-icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    className="equation-free-answer-banner__refresh"
                    onClick={() => setSimplifyLevelPickOpen(true)}
                    aria-label="Nová úloha — zvolit obtížnost"
                    title="Nová náhodná úloha"
                  >
                    <RefreshCw
                      className="equation-free-answer-banner__refresh-icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
              <FreeCanvasRightBar
                darkMode={freeDark}
                canUndo={freeHistoryPastRef.current.length > 0}
                canRedo={freeHistoryFutureRef.current.length > 0}
                onUndo={onUndoFree}
                onRedo={onRedoFree}
                isRecording={false}
                onToggleRecording={() => {}}
                showRecordingButton={false}
                notesOpen={freeShowNotes}
                onToggleNotes={() => setFreeShowNotes((o) => !o)}
                notesBadgeCount={freeSessionLog.length}
              />
              <FreeCanvasNotesPanel
                open={freeShowNotes}
                onClose={() => setFreeShowNotes(false)}
                darkMode={freeDark}
                notes={freeNotes}
                onNotesChange={setFreeNotes}
                sessionLog={freeSessionLog}
                isRecording={false}
              />
              {simplifyLevelPickOpen ? (
                <div
                  className={`equation-level-pick-backdrop${freeDark ? ' equation-level-pick-backdrop--dark' : ''}`}
                  role="presentation"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      setSimplifyLevelPickOpen(false)
                    }
                  }}
                >
                  <div
                    className="equation-level-pick"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="simplify-level-pick-title"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <h2
                      id="simplify-level-pick-title"
                      className="equation-level-pick__title"
                    >
                      Nová náhodná úloha
                    </h2>
                    <p className="equation-level-pick__hint">Zvolte obtížnost:</p>
                    <div className="equation-level-pick__actions">
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterSimplifyMode('basic')
                          setSimplifyLevelPickOpen(false)
                        }}
                      >
                        Základní
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterSimplifyMode('advanced')
                          setSimplifyLevelPickOpen(false)
                        }}
                      >
                        Pokročilý
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterSimplifyMode('master')
                          setSimplifyLevelPickOpen(false)
                        }}
                      >
                        Mistr
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn secondary equation-level-pick__cancel"
                      onClick={() => setSimplifyLevelPickOpen(false)}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : route === 'expand' ? (
            <>
              <FreeCanvasTopBar
                zoom={freeZoom}
                onZoomChange={freeZoomFromChrome}
                darkMode={freeDark}
                onDarkModeChange={setFreeDark}
                equalsMode={freeEqualsMode}
                onEqualsModeChange={setFreeEqualsMode}
                showEqualsButton={false}
              />
              {expandCalculatorOpen ? (
                <div
                  className={`simplify-free-calculator-wrap${freeDark ? ' simplify-free-calculator-wrap--dark' : ''}`}
                >
                  <SimplifyCalculator
                    inputRef={expandInputRef}
                    value={expandAnswer}
                    onChange={setExpandAnswer}
                    darkMode={freeDark}
                  />
                </div>
              ) : null}
              <div
                className={`expand-free-answer-banner equation-free-answer-banner equation-free-answer-banner--answer-route${freeDark ? ' expand-free-answer-banner--dark equation-free-answer-banner--dark' : ''}`}
                role="group"
                aria-label={`Roznásobte výraz — zadejte výsledek: ${expandTask.displayString}`}
              >
                {renderInlineAnswerFeedback()}
                <div className="equation-free-answer-banner__main-row expand-free-answer-banner__main-row">
                  <span className="expand-free-answer-banner__poly">
                    <MathText text={expandTask.displayString} />
                  </span>
                  <span
                    className="equation-free-answer-banner__equals"
                    aria-hidden
                  >
                    =
                  </span>
                  <input
                    ref={expandInputRef}
                    className="factor-bracket-input expand-free-answer-banner__input"
                    type="text"
                    inputMode="text"
                    value={expandAnswer}
                    onChange={(e) => setExpandAnswer(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Roznásobený polynom"
                  />
                  <button
                    type="button"
                    className="check-icon-button"
                    onClick={checkExpand}
                    aria-label="Zkontrolovat roznásobení"
                    title="Zkontrolovat"
                  >
                    <Check
                      className="check-icon-button__icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    className={`equation-free-answer-banner__calc${expandCalculatorOpen ? ' equation-free-answer-banner__calc--active' : ''}`}
                    onClick={() => setExpandCalculatorOpen((o) => !o)}
                    aria-label={
                      expandCalculatorOpen
                        ? 'Skrýt kalkulačku'
                        : 'Otevřít kalkulačku'
                    }
                    aria-expanded={expandCalculatorOpen}
                    title="Kalkulačka"
                  >
                    <Calculator
                      className="equation-free-answer-banner__calc-icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    className="equation-free-answer-banner__refresh"
                    onClick={() => setExpandLevelPickOpen(true)}
                    aria-label="Nová náhodná úloha — zvolit typ a obtížnost"
                    title="Nová náhodná úloha"
                  >
                    <RefreshCw
                      className="equation-free-answer-banner__refresh-icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
              <FreeCanvasRightBar
                darkMode={freeDark}
                canUndo={freeHistoryPastRef.current.length > 0}
                canRedo={freeHistoryFutureRef.current.length > 0}
                onUndo={onUndoFree}
                onRedo={onRedoFree}
                isRecording={false}
                onToggleRecording={() => {}}
                showRecordingButton={false}
                notesOpen={freeShowNotes}
                onToggleNotes={() => setFreeShowNotes((o) => !o)}
                notesBadgeCount={freeSessionLog.length}
              />
              <FreeCanvasNotesPanel
                open={freeShowNotes}
                onClose={() => setFreeShowNotes(false)}
                darkMode={freeDark}
                notes={freeNotes}
                onNotesChange={setFreeNotes}
                sessionLog={freeSessionLog}
                isRecording={false}
              />
              {expandLevelPickOpen ? (
                <div
                  className={`equation-level-pick-backdrop${freeDark ? ' equation-level-pick-backdrop--dark' : ''}`}
                  role="presentation"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      setExpandLevelPickOpen(false)
                    }
                  }}
                >
                  <div
                    className="equation-level-pick"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="expand-level-pick-title"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <h2
                      id="expand-level-pick-title"
                      className="equation-level-pick__title"
                    >
                      Nová náhodná úloha
                    </h2>
                    <p className="equation-level-pick__hint">Typ zadání:</p>
                    <div
                      className="equation-level-tabs equation-level-pick__kind"
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
                    <p className="equation-level-pick__hint">Obtížnost:</p>
                    <div className="equation-level-pick__actions">
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterExpandMode(expandKind, 'basic')
                          setExpandLevelPickOpen(false)
                        }}
                      >
                        Základní
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterExpandMode(expandKind, 'advanced')
                          setExpandLevelPickOpen(false)
                        }}
                      >
                        Pokročilá
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterExpandMode(expandKind, 'master')
                          setExpandLevelPickOpen(false)
                        }}
                      >
                        Mistr
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn secondary equation-level-pick__cancel"
                      onClick={() => setExpandLevelPickOpen(false)}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : route === 'factor' ? (
            <>
              <FreeCanvasTopBar
                zoom={freeZoom}
                onZoomChange={freeZoomFromChrome}
                darkMode={freeDark}
                onDarkModeChange={setFreeDark}
                equalsMode={freeEqualsMode}
                onEqualsModeChange={setFreeEqualsMode}
                showEqualsButton={false}
              />
              {factorCalculatorOpen ? (
                <div
                  className={`simplify-free-calculator-wrap${freeDark ? ' simplify-free-calculator-wrap--dark' : ''}`}
                >
                  <SimplifyCalculator
                    inputRef={
                      factorKbTarget === '1'
                        ? factorInput1Ref
                        : factorInput2Ref
                    }
                    value={
                      factorKbTarget === '1' ? factorExpr1 : factorExpr2
                    }
                    onChange={
                      factorKbTarget === '1'
                        ? setFactorExpr1
                        : setFactorExpr2
                    }
                    darkMode={freeDark}
                  />
                </div>
              ) : null}
              <div
                className={`factor-free-answer-banner equation-free-answer-banner equation-free-answer-banner--answer-route${freeDark ? ' factor-free-answer-banner--dark equation-free-answer-banner--dark' : ''}`}
                role="group"
                aria-label="Rozklad na součin — zadejte činitele v závorkách"
              >
                {renderInlineAnswerFeedback()}
                <div className="equation-free-answer-banner__main-row factor-free-answer-banner__main-row">
                  <span className="factor-free-answer-banner__poly">
                    <MathText text={polyDisplay} />
                  </span>
                  <span
                    className="equation-free-answer-banner__equals"
                    aria-hidden
                  >
                    =
                  </span>
                  <span className="task-poly__lit factor-free-answer-banner__paren" aria-hidden>
                    (
                  </span>
                  <input
                    ref={factorInput1Ref}
                    className="factor-bracket-input factor-free-answer-banner__bracket"
                    type="text"
                    inputMode="text"
                    value={factorExpr1}
                    onChange={(e) => setFactorExpr1(e.target.value)}
                    onFocus={() => setFactorKbTarget('1')}
                    aria-label="První činitel — celý výraz uvnitř závorky"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="task-poly__lit factor-free-answer-banner__paren" aria-hidden>
                    ){MUL_DOT}(
                  </span>
                  <input
                    ref={factorInput2Ref}
                    className="factor-bracket-input factor-free-answer-banner__bracket"
                    type="text"
                    inputMode="text"
                    value={factorExpr2}
                    onChange={(e) => setFactorExpr2(e.target.value)}
                    onFocus={() => setFactorKbTarget('2')}
                    aria-label="Druhý činitel — celý výraz uvnitř závorky"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="task-poly__lit factor-free-answer-banner__paren" aria-hidden>
                    )
                  </span>
                  <button
                    type="button"
                    className="check-icon-button"
                    onClick={checkFactorization}
                    aria-label="Zkontrolovat rozklad — součin činitelů"
                    title="Zkontrolovat rozklad"
                  >
                    <Check
                      className="check-icon-button__icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    className={`equation-free-answer-banner__calc${factorCalculatorOpen ? ' equation-free-answer-banner__calc--active' : ''}`}
                    onClick={() => setFactorCalculatorOpen((o) => !o)}
                    aria-label={
                      factorCalculatorOpen
                        ? 'Skrýt kalkulačku'
                        : 'Otevřít kalkulačku'
                    }
                    aria-expanded={factorCalculatorOpen}
                    title="Kalkulačka"
                  >
                    <Calculator
                      className="equation-free-answer-banner__calc-icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    className="equation-free-answer-banner__refresh"
                    onClick={() => setFactorLevelPickOpen(true)}
                    aria-label="Nová náhodná úloha — zvolit obtížnost"
                    title="Nová náhodná úloha"
                  >
                    <RefreshCw
                      className="equation-free-answer-banner__refresh-icon"
                      size={22}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
              <FreeCanvasRightBar
                darkMode={freeDark}
                canUndo={freeHistoryPastRef.current.length > 0}
                canRedo={freeHistoryFutureRef.current.length > 0}
                onUndo={onUndoFree}
                onRedo={onRedoFree}
                isRecording={false}
                onToggleRecording={() => {}}
                showRecordingButton={false}
                notesOpen={freeShowNotes}
                onToggleNotes={() => setFreeShowNotes((o) => !o)}
                notesBadgeCount={freeSessionLog.length}
              />
              <FreeCanvasNotesPanel
                open={freeShowNotes}
                onClose={() => setFreeShowNotes(false)}
                darkMode={freeDark}
                notes={freeNotes}
                onNotesChange={setFreeNotes}
                sessionLog={freeSessionLog}
                isRecording={false}
              />
              {factorLevelPickOpen ? (
                <div
                  className={`equation-level-pick-backdrop${freeDark ? ' equation-level-pick-backdrop--dark' : ''}`}
                  role="presentation"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      setFactorLevelPickOpen(false)
                    }
                  }}
                >
                  <div
                    className="equation-level-pick"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="factor-level-pick-title"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <h2
                      id="factor-level-pick-title"
                      className="equation-level-pick__title"
                    >
                      Nová náhodná úloha
                    </h2>
                    <p className="equation-level-pick__hint">Zvolte obtížnost:</p>
                    <div className="equation-level-pick__actions">
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterFactorMode('basic')
                          setFactorLevelPickOpen(false)
                        }}
                      >
                        Základní
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterFactorMode('advanced')
                          setFactorLevelPickOpen(false)
                        }}
                      >
                        Pokročilý
                      </button>
                      <button
                        type="button"
                        className="btn primary equation-level-pick__btn"
                        onClick={() => {
                          enterFactorMode('master')
                          setFactorLevelPickOpen(false)
                        }}
                      >
                        Mistr
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn secondary equation-level-pick__cancel"
                      onClick={() => setFactorLevelPickOpen(false)}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          <div
            ref={scrollRef}
            className={`workspace-scroll${isFreeGeometry ? ' workspace-scroll--free-geo' : ''}${isFreeGeometry && freeDark ? ' workspace-scroll--free-geo-dark' : ''}`}
          >
            <div
              className={`workspace-board-fill${isFreeGeometry ? ' workspace-board-fill--free-viewport' : ''}`}
            >
              {isFreeGeometry ? (
                <>
                  <div
                    ref={boardRef}
                    className={`workspace workspace--free-outer${freeCanvasTool === 'move' ? ' workspace--free-outer--pan-tool' : ''}${freeCanvasTool === 'erase' ? ' workspace--free-outer--erase-tool' : ''}`}
                    data-workspace
                    style={{
                      flex: 1,
                      width: '100%',
                      minHeight: 0,
                      position: 'relative',
                      overflow: 'hidden',
                      touchAction:
                        freeCanvasTool === 'move' ? 'none' : undefined,
                    }}
                    onClick={onBoardClick}
                    onPointerDown={onFreeWorkspacePointerDown}
                  >
                    <div
                      className="free-camera"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        transform: `translate(${freePan.x}px, ${freePan.y}px) scale(${freeZoom})`,
                        transformOrigin: '0 0',
                        willChange: 'transform',
                      }}
                    >
                      <div
                        className={`free-canvas-paper${freeDark ? ' free-canvas-paper--dark' : ''}`}
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: innerW - FREE_CANVAS_PAN_ROOM_PX,
                          height: innerH - FREE_CANVAS_PAN_ROOM_PX,
                          zIndex: 0,
                          pointerEvents: 'none',
                        }}
                        aria-hidden
                      />
                      <div
                        ref={freeBoardInnerRef}
                        className="workspace workspace--free-inner"
                        style={{
                          width: innerW,
                          height: innerH,
                          position: 'relative',
                          zIndex: 1,
                          touchAction:
                            freeCanvasTool === 'move' ? 'none' : undefined,
                        }}
                        onPointerDown={onFreeBoardInnerPointerDown}
                      >
                        {isFreeGeometry && freeEqualsMode ? (
                          <div
                            className={`free-eq-band${freeDark ? ' free-eq-band--dark' : ''}`}
                            style={{
                              position: 'absolute',
                              left: freeEqBandLeft,
                              width: FREE_GRID_CELL_PX,
                              top: '-60000px',
                              height: '120000px',
                              zIndex: 0,
                              pointerEvents: 'none',
                              boxSizing: 'border-box',
                            }}
                            aria-hidden
                          />
                        ) : null}
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
                    {freeEdgeSnapGuides.map((guide, gi) =>
                      guide.axis === 'x' ? (
                        <div
                          key={`fsnap-v-${gi}`}
                          className="free-edge-snap-guide free-edge-snap-guide--v"
                          style={{
                            position: 'absolute',
                            left: guide.at - 1.5,
                            top: guide.from,
                            width: 3,
                            height: Math.max(0, guide.to - guide.from),
                            pointerEvents: 'none',
                            zIndex: 5,
                            boxSizing: 'border-box',
                          }}
                          aria-hidden
                        />
                      ) : (
                        <div
                          key={`fsnap-h-${gi}`}
                          className="free-edge-snap-guide free-edge-snap-guide--h"
                          style={{
                            position: 'absolute',
                            left: guide.from,
                            top: guide.at - 1.5,
                            width: Math.max(0, guide.to - guide.from),
                            height: 3,
                            pointerEvents: 'none',
                            zIndex: 5,
                            boxSizing: 'border-box',
                          }}
                          aria-hidden
                        />
                      )
                    )}
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
                              : (side) => duplicatePlacedTile(t, side)
                          }
                          onFlipSign={
                            inMultiFree
                              ? undefined
                              : () => flipTileSign(t)
                          }
                          duplicatePlacement={
                            inMultiFree
                              ? undefined
                              : duplicateEdgesFree(t, tiles, 'freeGrid')
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
                          className="algebra-tile__duplicate algebra-tile__duplicate--bottom free-selection-chrome__duplicate"
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
                  </div>
                  {isFreeGeometry &&
                  freeEqualsMode &&
                  freeEqMarkScreenPos ? (
                    <div
                      className={`free-eq-viewport-mark${
                        freeDark ? ' free-eq-viewport-mark--dark' : ''
                      }`}
                      style={{
                        left: freeEqMarkScreenPos.left,
                        top: freeEqMarkScreenPos.top,
                      }}
                      aria-hidden
                    >
                      =
                    </div>
                  ) : null}
                </>
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
                  {tiles.map((t) => (
                    <TileView
                      key={t.id}
                      tile={t}
                      layout="board"
                      selected={selectedTileIds.includes(t.id)}
                      dragging={drag?.kind === 'tile' && drag.id === t.id}
                      onPointerDown={(e) => onTilePointerDown(t, e)}
                      onPointerUp={onTilePointerUp}
                      onDoubleClick={(e) => onTileDoubleClick(t, e)}
                      onContextMenu={(e) => onTileContextMenu(t, e)}
                      onDuplicate={(side) => duplicatePlacedTile(t, side)}
                      onFlipSign={() => flipTileSign(t)}
                      duplicatePlacement={duplicateEdgesFree(t, tiles, 'algebra')}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {route === 'equation' ? (
          <aside
            className="bank-sidebar bank-sidebar--free-tools bank-sidebar--equation-right"
            data-bank-drop
            aria-label="Zásobník dlaždic na pravé straně"
            draggable={false}
            onDragStart={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <h2 className="bank-heading bank-heading--rail bank-heading--sr-only">
              Zásobník dlaždic (pravá strana)
            </h2>
            <div className="bank-grid bank-grid--rail bank-grid--equation-right">
              {renderFreeRailBankCells()}
            </div>
          </aside>
        ) : null}
      </div>

      {drag?.kind === 'fromBank' && bankGhostPos ? (
        <div
          className="bank-drag-ghost"
          style={{
            position: 'fixed',
            left: bankGhostPos.x,
            top: bankGhostPos.y,
            zIndex: 10000,
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
            dragging
            nonInteractive
            geometry={isFreeGeometry ? 'freeGrid' : 'algebra'}
            onPointerDown={() => {}}
            onDoubleClick={() => {}}
          />
        </div>
      ) : null}
    </div>
  )
}
