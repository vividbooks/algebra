import {
  ALGEBRA_TILE_FRAME_INSET_STROKE_PX,
  ALGEBRA_TILE_FRAME_UNDERLAY_SHIFT_PX,
  FREE_GRID_X1_SHORT_PX,
  TYPO_MINUS,
  UNIT_PX,
} from '../constants'
import type { PlacedTile } from '../lib/tiles'
import { tileFootprintForMode, type TileGeomMode } from '../lib/tiles'
import { Minus, Plus } from 'lucide-react'
import { MathText } from './MathText'

function labelFor(kind: PlacedTile['kind'], negative: boolean): string {
  if (kind === 'x2') return negative ? `${TYPO_MINUS}x²` : 'x²'
  if (kind === 'x1') return negative ? `${TYPO_MINUS}x` : 'x'
  return negative ? `${TYPO_MINUS}1` : '1'
}

interface TileViewProps {
  tile: PlacedTile
  selected: boolean
  dragging: boolean
  /** Na ploše — absolute podle tile.x/y; v zásobníku — relative 0,0 */
  layout?: 'board' | 'static'
  /** Náhled ve zdroji — bez pointer událostí (nadřazený prvek bere drag) */
  nonInteractive?: boolean
  /** Skrytý náhled (tažení řeší fixed ghost nad celou aplikací). */
  concealed?: boolean
  /** Volné plátno — rozměry násobků mřížky (50 px), jinak klasická algebra. */
  geometry?: TileGeomMode
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  onDoubleClick: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** Plocha — po najetí myší tlačítko + pod dlaždicí (kopie vedle podle volného místa). */
  onDuplicate?: () => void
  /** Plocha — přepnutí znaménka (jako kontextové menu / pravý klik). */
  onFlipSign?: () => void
  /** Přehrávání záznamu — nulový pár před odstraněním (slabá neprůhlednost + přeškrtnutí). */
  playbackZeroPairDim?: boolean
}

export function TileView({
  tile,
  selected,
  dragging,
  layout = 'board',
  nonInteractive = false,
  concealed = false,
  geometry = 'algebra',
  onPointerDown,
  onPointerUp,
  onDoubleClick,
  onContextMenu,
  onDuplicate,
  onFlipSign,
  playbackZeroPairDim = false,
}: TileViewProps) {
  const { w, h } = tileFootprintForMode(tile.kind, tile.rot, geometry)
  const onBoard = layout === 'board'
  const showHoverChrome =
    onBoard &&
    !nonInteractive &&
    !concealed &&
    (onDuplicate != null || onFlipSign != null)
  const minSide = Math.min(w, h)
  const fontSize =
    tile.kind === 'unit'
      ? Math.min(18, h * 0.55)
      : tile.kind === 'x1'
        ? minSide * 0.52
        : h * 0.28
  const strokeW = ALGEBRA_TILE_FRAME_INSET_STROKE_PX
  /* Stejné zakřivení jako u x / 1 — u x² nešlapat z větší strany čtverce. */
  const refShort = geometry === 'freeGrid' ? FREE_GRID_X1_SHORT_PX : UNIT_PX
  const radius = Math.min(Math.min(minSide, refShort) * 0.16, 26)
  const shift = ALGEBRA_TILE_FRAME_UNDERLAY_SHIFT_PX

  return (
    <div
      className={`algebra-tile algebra-tile--${tile.kind}${tile.negative ? ' algebra-tile--neg' : ''}${tile.negative ? ' algebra-tile--pt-palette-neg' : ' algebra-tile--pt-palette-pos'}${selected ? ' algebra-tile--selected' : ''}${dragging ? ' algebra-tile--drag' : ''}${showHoverChrome ? ' algebra-tile--hover-chrome' : ''}${playbackZeroPairDim ? ' algebra-tile--playback-zero-pair' : ''}`}
      style={{
        ['--at-stroke' as string]: `${strokeW}px`,
        ['--at-r' as string]: `${radius}px`,
        ['--at-shift' as string]: `${shift}px`,
        ['--at-min' as string]: `${minSide}px`,
        position: onBoard ? 'absolute' : 'relative',
        left: onBoard ? tile.x : 0,
        top: onBoard ? tile.y : 0,
        width: w,
        height: h,
        boxSizing: 'border-box',
        opacity: concealed ? 0 : 1,
        cursor: nonInteractive ? 'inherit' : 'grab',
        touchAction: nonInteractive ? 'auto' : 'none',
        userSelect: 'none',
        pointerEvents: nonInteractive ? 'none' : 'auto',
        zIndex: onBoard ? (dragging ? 500 : selected ? 20 : 1) : 0,
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={nonInteractive ? undefined : onContextMenu}
    >
      {showHoverChrome && onFlipSign ? (
        <>
          <span
            className="algebra-tile__hover-bridge-top"
            aria-hidden
            onPointerDown={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            role="switch"
            aria-checked={tile.negative}
            className={`algebra-tile__sign-toggle${tile.negative ? ' algebra-tile__sign-toggle--neg' : ' algebra-tile__sign-toggle--pos'}`}
            aria-label={
              tile.negative
                ? 'Záporná dlaždice, přepnout na kladnou'
                : 'Kladná dlaždice, přepnout na zápornou'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onFlipSign()
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <span className="algebra-tile__sign-toggle__thumb" aria-hidden>
              {tile.negative ? (
                <Minus size={12} strokeWidth={2.6} />
              ) : (
                <Plus size={12} strokeWidth={2.6} />
              )}
            </span>
          </button>
        </>
      ) : null}
      <span className="algebra-tile__underlay" aria-hidden />
      <span
        className="algebra-tile__face"
        style={{
          fontSize,
          textShadow: tile.negative
            ? 'none'
            : '0 1px 1px rgb(0 0 0 / 0.22)',
        }}
      >
        <span className="algebra-tile__label">
          <MathText text={labelFor(tile.kind, tile.negative)} />
        </span>
      </span>
      {showHoverChrome && onDuplicate ? (
        <>
          <span
            className="algebra-tile__hover-bridge"
            aria-hidden
            onPointerDown={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="algebra-tile__duplicate"
            aria-label="Zkopírovat dlaždici"
            onPointerDown={(e) => {
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <Plus size={15} strokeWidth={2.6} aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  )
}
