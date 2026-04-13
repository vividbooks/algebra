import { TYPO_MINUS } from '../constants'
import { polyUpTo3Chunks } from '../lib/parsePolyUpTo3'
import { polynomialFromPlacedTiles, type PlacedTile } from '../lib/tiles'
import { MathText } from './MathText'

/** Sloučený zápis z dlaždic (x², x, jedničky se sčítají) s barvou záporné / kladné jako u dlaždic. */
export function MergedColoredPolyExpr({ tiles }: { tiles: PlacedTile[] }) {
  const chunks = polyUpTo3Chunks(polynomialFromPlacedTiles(tiles))
  if (chunks.length === 0) {
    return (
      <span className="free-poly-term free-poly-term--zero">
        <MathText text="0" />
      </span>
    )
  }
  return (
    <>
      {chunks.map((chunk, i) => {
        const isPos = chunk.plus
        const prefix =
          i === 0
            ? isPos
              ? ''
              : `${TYPO_MINUS} `
            : isPos
              ? ' + '
              : ` ${TYPO_MINUS} `
        const cls = isPos
          ? 'free-poly-term free-poly-term--pos'
          : 'free-poly-term free-poly-term--neg'
        return (
          <span key={`${i}-${chunk.text}`} className={cls}>
            {prefix}
            <MathText text={chunk.text} />
          </span>
        )
      })}
    </>
  )
}
