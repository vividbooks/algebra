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
  EQUATION_EXTRA_EQUALS_ROWS,
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
  hasOverlap,
  tilesAreZeroPairOverlapping,
  polynomialFromPlacedTiles,
  overlapsOthers,
  parseBankKey,
  tileFootprint,
  type BankKey,
  type PlacedTile,
  type TileKind,
} from './lib/tiles'
import { magneticPosition } from './lib/magnet'
import { MathKeyboard } from './components/MathKeyboard'
import { MathText } from './components/MathText'
import { parseLinearBinomial } from './lib/parseLinearBinomial'
import {
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
  originGx: number
  originGy: number
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

const SOURCE_META: { kind: TileKind; negative: boolean; caption: string }[] =
  [
    { kind: 'x2', negative: false, caption: 'x²' },
    { kind: 'x2', negative: true, caption: `${TYPO_MINUS}x²` },
    { kind: 'x1', negative: false, caption: 'x' },
    { kind: 'x1', negative: true, caption: `${TYPO_MINUS}x` },
    { kind: 'unit', negative: false, caption: '1' },
    { kind: 'unit', negative: true, caption: `${TYPO_MINUS}1` },
  ]

function resizeToFitTiles(tiles: PlacedTile[]): { gw: number; gh: number } {
  let maxR = X_PX * 3 + BOARD_PAD_PX
  let maxB = X_PX * 3 + BOARD_PAD_PX
  for (const t of tiles) {
    const { w, h } = tileFootprint(t.kind, t.rot)
    maxR = Math.max(maxR, t.x + w + BOARD_PAD_PX)
    maxB = Math.max(maxB, t.y + h + BOARD_PAD_PX)
  }
  return { gw: maxR, gh: maxB }
}

function snapCoord(v: number): number {
  return Math.round(v / SNAP_PX) * SNAP_PX
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
    setSelectedId(null)
    setDrag(null)
    setCheckFeedback(null)
    setEquationAnswer('')
  }, [])

  const enterFactorMode = useCallback((level: FactorLevel) => {
    setFactorLevel(level)
    setTask(generateFactorTask(level))
    setTiles([])
    setSelectedId(null)
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
    setSelectedId(null)
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragMode>(null)
  /** Výsledek kontroly odpovědi — vždy jen krátká zpráva v postranním panelu. */
  const [checkFeedback, setCheckFeedback] = useState<
    'success' | 'fail' | null
  >(null)
  const [showControlsHelp, setShowControlsHelp] = useState(false)
  /** Celé lineární činitele (obsah závorky), např. x+3 nebo 2x-1. */
  const [factorExpr1, setFactorExpr1] = useState('')
  const [factorExpr2, setFactorExpr2] = useState('')
  /** Který činitel dostává znaky z matematické klávesnice. */
  const [factorKbTarget, setFactorKbTarget] = useState<'1' | '2'>('1')
  const [viewSize, setViewSize] = useState({ w: 400, h: 400 })

  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  const boardRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const factorInput1Ref = useRef<HTMLInputElement>(null)
  const factorInput2Ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setShowControlsHelp(false)
  }, [route])

  const applyTask = useCallback(() => {
    setTiles([])
    setSelectedId(null)
    setDrag(null)
    setCheckFeedback(null)
    setFactorExpr1('')
    setFactorExpr2('')
    setEquationAnswer('')
    setExpandAnswer('')
  }, [])

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
    setSelectedId(null)
    setDrag(null)
    setCheckFeedback(null)
    setSimplifyAnswer('')
  }, [simplifyTask.id, route])

  useEffect(() => {
    if (route !== 'equation') return
    if (prevLinearTaskIdRef.current === linearTask.id) return
    prevLinearTaskIdRef.current = linearTask.id
    setTiles([])
    setSelectedId(null)
    setDrag(null)
    setCheckFeedback(null)
    setEquationAnswer('')
  }, [linearTask.id, route])

  useEffect(() => {
    if (route !== 'expand') return
    if (prevExpandTaskIdRef.current === expandTask.id) return
    prevExpandTaskIdRef.current = expandTask.id
    setTiles([])
    setSelectedId(null)
    setDrag(null)
    setCheckFeedback(null)
    setExpandAnswer('')
  }, [expandTask.id, route])

  useEffect(() => {
    if (route !== 'expand') return
    setExpandTask(generateExpandTask(expandKind, expandLevel))
  }, [route, expandKind, expandLevel])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setViewSize({
        w: Math.max(200, r.width),
        h: Math.max(200, r.height),
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { gw, gh: ghTiles } = useMemo(() => resizeToFitTiles(tiles), [tiles])
  const innerW = Math.max(gw, viewSize.w)
  const innerH = Math.max(ghTiles, viewSize.h)

  const tryPlaceFromBankAt = useCallback((key: BankKey, px: number, py: number) => {
    const { kind, negative } = parseBankKey(key)
    const baseId = crypto.randomUUID()
    const others = tilesRef.current
    const rawX = Math.max(0, snapCoord(px))
    const rawY = Math.max(0, snapCoord(py))
    const draft: PlacedTile = {
      id: baseId,
      kind,
      negative,
      rot: 0,
      x: rawX,
      y: rawY,
    }
    const { x, y } = magneticPosition(
      draft,
      rawX,
      rawY,
      others,
      MAGNET_SNAP_PX
    )
    const candidate: PlacedTile = { ...draft, x, y }
    const pair = others.find((o) => tilesAreZeroPairOverlapping(candidate, o))
    if (pair) {
      setTiles(others.filter((t) => t.id !== pair.id))
      return
    }
    const next = [...others, candidate]
    if (hasOverlap(next)) return
    setTiles(next)
  }, [])

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

  const removeTileFromBoard = useCallback((tile: PlacedTile) => {
    setTiles((prev) => prev.filter((t) => t.id !== tile.id))
    setSelectedId((id) => (id === tile.id ? null : id))
  }, [])

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
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      if (drag.kind === 'fromBank') {
        setBankGhostPos({
          x: e.clientX - drag.grabOffX,
          y: e.clientY - drag.grabOffY,
        })
        return
      }
      if (drag.kind === 'tile') {
        setTileGhostPos({
          x: e.clientX - drag.grabOffX,
          y: e.clientY - drag.grabOffY,
        })
        const nx =
          drag.originGx +
          Math.round((e.clientX - drag.startPx) / SNAP_PX) * SNAP_PX
        const ny =
          drag.originGy +
          Math.round((e.clientY - drag.startPy) / SNAP_PX) * SNAP_PX
        moveTileTo(drag.id, nx, ny, 'liveDrag')
        return
      }
    }

    const onUp = (e: PointerEvent) => {
      const hit = document.elementFromPoint(e.clientX, e.clientY)
      const onBank = hit?.closest('[data-bank-drop]')

      if (drag.kind === 'tile') {
        if (onBank) {
          const t = tilesRef.current.find((x) => x.id === drag.id)
          if (t) removeTileFromBoard(t)
        } else {
          const { id: dragId, originGx, originGy } = drag
          setTiles((prev) => {
            const t = prev.find((x) => x.id === dragId)
            if (!t) return prev
            const others = prev.filter((x) => x.id !== dragId)
            const pair = others.find((o) =>
              tilesAreZeroPairOverlapping(t, o)
            )
            if (pair) {
              setSelectedId((sid) =>
                sid === dragId || sid === pair.id ? null : sid
              )
              return prev.filter(
                (p) => p.id !== dragId && p.id !== pair.id
              )
            }
            if (overlapsOthers([...others, t], t)) {
              return prev.map((p) =>
                p.id === dragId
                  ? { ...p, x: originGx, y: originGy }
                  : p
              )
            }
            const clampX = Math.max(0, snapCoord(t.x))
            const clampY = Math.max(0, snapCoord(t.y))
            const { x, y } = magneticPosition(
              t,
              clampX,
              clampY,
              others,
              MAGNET_SNAP_PX
            )
            const settled: PlacedTile = { ...t, x, y }
            if (overlapsOthers([...others, settled], settled)) {
              return prev.map((p) =>
                p.id === dragId
                  ? { ...p, x: originGx, y: originGy }
                  : p
              )
            }
            return prev.map((p) => (p.id === dragId ? settled : p))
          })
        }
        setDrag(null)
        return
      }

      if (drag.kind === 'fromBank') {
        if (onBank) {
          setDrag(null)
          return
        }
        const el = boardRef.current
        if (el) {
          const r = el.getBoundingClientRect()
          const { w, h } = drag
          if (
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          ) {
            const px = snapCoord(e.clientX - r.left - w / 2)
            const py = snapCoord(e.clientY - r.top - h / 2)
            tryPlaceFromBankAt(drag.key, px, py)
          }
        }
        setDrag(null)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, moveTileTo, removeTileFromBoard, tryPlaceFromBankAt])

  const onBankPointerDown = (key: BankKey, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const { kind } = parseBankKey(key)
    const { w, h } = tileFootprint(kind, 0)
    const el = e.currentTarget as HTMLElement
    const br = el.getBoundingClientRect()
    const grabOffX = e.clientX - br.left
    const grabOffY = e.clientY - br.top
    setDrag({ kind: 'fromBank', key, w, h, grabOffX, grabOffY })
    setBankGhostPos({
      x: e.clientX - grabOffX,
      y: e.clientY - grabOffY,
    })
  }

  const onTilePointerDown = (tile: PlacedTile, e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const br = el.getBoundingClientRect()
    const grabOffX = e.clientX - br.left
    const grabOffY = e.clientY - br.top
    setSelectedId(tile.id)
    setTileGhostPos({
      x: e.clientX - grabOffX,
      y: e.clientY - grabOffY,
    })
    setDrag({
      kind: 'tile',
      id: tile.id,
      startPx: e.clientX,
      startPy: e.clientY,
      originGx: tile.x,
      originGy: tile.y,
      grabOffX,
      grabOffY,
    })
    el.setPointerCapture(e.pointerId)
  }

  const onTilePointerUp = (e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const onTileContextMenu = (tile: PlacedTile, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (drag) return
    setTiles((prev) => {
      const t = prev.find((x) => x.id === tile.id)
      if (!t) return prev
      const flipped: PlacedTile = { ...t, negative: !t.negative }
      const others = prev.filter((x) => x.id !== tile.id)
      const pair = others.find((o) => tilesAreZeroPairOverlapping(flipped, o))
      if (pair) {
        setSelectedId((sid) =>
          sid === tile.id || sid === pair.id ? null : sid
        )
        return others.filter((p) => p.id !== pair.id)
      }
      const { x, y } = magneticPosition(
        flipped,
        flipped.x,
        flipped.y,
        others,
        MAGNET_SNAP_PX
      )
      const adjusted: PlacedTile = { ...flipped, x, y }
      if (overlapsOthers([...others, adjusted], adjusted)) return prev
      return prev.map((x) => (x.id === tile.id ? adjusted : x))
    })
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
      const { x, y } = magneticPosition(
        turned,
        turned.x,
        turned.y,
        others,
        MAGNET_SNAP_PX
      )
      const next: PlacedTile = { ...turned, x, y }
      if (overlapsOthers([...others, next], next)) return prev
      return prev.map((x) => (x.id === tile.id ? next : x))
    })
  }

  const onBoardClick = () => setSelectedId(null)

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
              setSelectedId(null)
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
              setSelectedId(null)
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
    <div className="app app--fill">
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

      <div className="app__body">
        <aside className="bank-sidebar panel" data-bank-drop>
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
          <h2 className="bank-heading">Zásobník dlaždic</h2>
          <div className="bank-grid">
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
              return (
                <div key={key} className="bank-cell">
                  <div
                    className="bank-cell__drop"
                    onPointerDown={(e) => onBankPointerDown(key, e)}
                    title={caption}
                    aria-label={`Přetáhnout dlaždici ${caption}`}
                  >
                    <TileView
                      tile={template}
                      layout="static"
                      selected={false}
                      dragging={false}
                      nonInteractive
                      onPointerDown={() => {}}
                      onDoubleClick={() => {}}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="bank-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => applyTask()}
            >
              Vyčistit plochu a vstupy
            </button>
          </div>
        </aside>

        <section className="workspace-column">
          <div ref={scrollRef} className="workspace-scroll">
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
                      {Array.from({ length: EQUATION_EXTRA_EQUALS_ROWS }, (_, i) => (
                        <span
                          key={i}
                          className="workspace-equation-scaffold__rail-mark"
                        >
                          =
                        </span>
                      ))}
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
                  selected={t.id === selectedId}
                  dragging={drag?.kind === 'tile' && drag.id === t.id}
                  concealed={drag?.kind === 'tile' && drag.id === t.id}
                  onPointerDown={(e) => onTilePointerDown(t, e)}
                  onPointerUp={onTilePointerUp}
                  onDoubleClick={(e) => onTileDoubleClick(t, e)}
                  onContextMenu={(e) => onTileContextMenu(t, e)}
                />
              ))}
              </div>
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
            onPointerDown={() => {}}
            onPointerUp={() => {}}
            onDoubleClick={() => {}}
          />
        </div>
      ) : null}
    </div>
  )
}
