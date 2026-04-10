import { TYPO_MINUS } from '../constants'
import type { PlacedTile } from '../lib/tiles'
import { tileFootprint } from '../lib/tiles'
import { MathText } from './MathText'

/** Kladné dlaždice — jednotná modrá; záporné červené. */
const POS_BLUE = ['#2563eb', '#60a5fa'] as const

const COLORS = {
  x2: { pos: POS_BLUE, neg: ['#c43d3d', '#e85d5d'] },
  x1: { pos: POS_BLUE, neg: ['#b91c1c', '#f87171'] },
  unit: { pos: POS_BLUE, neg: ['#991b1b', '#ef4444'] },
} as const

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
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  onDoubleClick: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function TileView({
  tile,
  selected,
  dragging,
  layout = 'board',
  nonInteractive = false,
  concealed = false,
  onPointerDown,
  onPointerUp,
  onDoubleClick,
  onContextMenu,
}: TileViewProps) {
  const { w, h } = tileFootprint(tile.kind, tile.rot)
  const pal = COLORS[tile.kind][tile.negative ? 'neg' : 'pos']
  const [c0, c1] = pal
  const onBoard = layout === 'board'
  const minSide = Math.min(w, h)
  const fontSize =
    tile.kind === 'unit'
      ? Math.min(18, h * 0.55)
      : tile.kind === 'x1'
        ? minSide * 0.52
        : h * 0.28

  return (
    <div
      className={`algebra-tile algebra-tile--${tile.kind}${tile.negative ? ' algebra-tile--neg' : ''}${selected ? ' algebra-tile--selected' : ''}${dragging ? ' algebra-tile--drag' : ''}`}
      style={{
        position: onBoard ? 'absolute' : 'relative',
        left: onBoard ? tile.x : 0,
        top: onBoard ? tile.y : 0,
        width: w,
        height: h,
        boxSizing: 'border-box',
        borderRadius: Math.min(10, Math.floor(Math.min(w, h) * 0.08)),
        border: `${Math.max(2, Math.floor(Math.min(w, h) * 0.04))}px solid rgba(0,0,0,0.18)`,
        background: `linear-gradient(145deg, ${c0}, ${c1})`,
        boxShadow: dragging
          ? '0 10px 28px rgba(0,0,0,0.28)'
          : '0 2px 8px rgba(0,0,0,0.12)',
        opacity: concealed ? 0 : 1,
        cursor: nonInteractive ? 'inherit' : 'grab',
        touchAction: nonInteractive ? 'auto' : 'none',
        userSelect: 'none',
        pointerEvents: nonInteractive ? 'none' : 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.95)',
        fontWeight: 700,
        fontSize,
        textShadow: '0 1px 2px rgba(0,0,0,0.25)',
        zIndex: onBoard ? (dragging ? 500 : selected ? 20 : 1) : 0,
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={nonInteractive ? undefined : onContextMenu}
    >
      <span>
        <MathText text={labelFor(tile.kind, tile.negative)} />
      </span>
    </div>
  )
}
