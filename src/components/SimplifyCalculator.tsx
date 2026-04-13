import { useCallback } from 'react'
import { TYPO_MINUS } from '../constants'
import { MathText } from './MathText'

/**
 * Jednoduchá kalkulačka pro zápis polynomu (inspirováno „simple“ klávesnicí ve Vividbooks).
 * Číslice, +, −, násobení ·, proměnná x, x², zpět a smazat vše.
 */
type SimplifyCalculatorProps = {
  inputRef: React.RefObject<HTMLInputElement | null>
  value: string
  onChange: (next: string) => void
  darkMode?: boolean
}

const BACKSPACE_SENTINEL = '\u232B'

const DIGITS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'] as const

export function SimplifyCalculator({
  inputRef,
  value,
  onChange,
  darkMode = false,
}: SimplifyCalculatorProps) {
  const insert = useCallback(
    (ch: string) => {
      const el = inputRef.current
      const start = el?.selectionStart ?? value.length
      const end = el?.selectionEnd ?? start
      let insertText = ch
      if (ch === 'x²') insertText = 'x²'
      else if (ch === TYPO_MINUS || ch === '\u2212') insertText = TYPO_MINUS
      else if (ch === BACKSPACE_SENTINEL) {
        if (start === end && start > 0) {
          const next = value.slice(0, start - 1) + value.slice(end)
          onChange(next)
          requestAnimationFrame(() => {
            el?.focus()
            const p = start - 1
            el?.setSelectionRange(p, p)
          })
          return
        }
        const next = value.slice(0, start) + value.slice(end)
        onChange(next)
        requestAnimationFrame(() => {
          el?.focus()
          el?.setSelectionRange(start, start)
        })
        return
      }
      const next = value.slice(0, start) + insertText + value.slice(end)
      onChange(next)
      requestAnimationFrame(() => {
        el?.focus()
        const pos = start + insertText.length
        el?.setSelectionRange(pos, pos)
      })
    },
    [inputRef, value, onChange]
  )

  const root = `simplify-calculator${darkMode ? ' simplify-calculator--dark' : ''}`

  return (
    <div className={root} aria-label="Kalkulačka pro zápis výrazu">
      <div className="simplify-calculator__row simplify-calculator__row--tools">
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--danger"
          title="Smazat vše"
          aria-label="Smazat vše"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
        >
          AC
        </button>
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--warn"
          title="Smazat znak"
          aria-label="Smazat znak"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(BACKSPACE_SENTINEL)}
        >
          {'\u232B'}
        </button>
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--op"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('+')}
        >
          +
        </button>
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--op"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(TYPO_MINUS)}
        >
          −
        </button>
      </div>
      <div className="simplify-calculator__row">
        {DIGITS.slice(0, 3).map((d) => (
          <button
            key={d}
            type="button"
            className="simplify-calculator__key simplify-calculator__key--num"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--op"
          title="Násobení (tečka se při kontrole ignoruje)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('\u00B7')}
        >
          ×
        </button>
      </div>
      <div className="simplify-calculator__row">
        {DIGITS.slice(3, 6).map((d) => (
          <button
            key={d}
            type="button"
            className="simplify-calculator__key simplify-calculator__key--num"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--op simplify-calculator__key--poly-var"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('x')}
        >
          <MathText text="x" />
        </button>
      </div>
      <div className="simplify-calculator__row">
        {DIGITS.slice(6, 9).map((d) => (
          <button
            key={d}
            type="button"
            className="simplify-calculator__key simplify-calculator__key--num"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--op simplify-calculator__key--poly-var"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('x²')}
        >
          <MathText text="x²" />
        </button>
      </div>
      <div className="simplify-calculator__row">
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--num simplify-calculator__key--span3"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('0')}
        >
          0
        </button>
        <button
          type="button"
          className="simplify-calculator__key simplify-calculator__key--op"
          title="Mezera"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(' ')}
        >
          mezera
        </button>
      </div>
    </div>
  )
}
