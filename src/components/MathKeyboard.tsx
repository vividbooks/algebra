import { useCallback } from 'react'
import { TYPO_MINUS } from '../constants'
import { MathText } from './MathText'

type MathKeyboardProps = {
  inputRef: React.RefObject<HTMLInputElement | null>
  value: string
  onChange: (next: string) => void
}

const ROW_DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

const ROW_REST = ['⌫', '+', TYPO_MINUS, 'x', 'x²', ' '] as const

export function MathKeyboard({
  inputRef,
  value,
  onChange,
}: MathKeyboardProps) {
  const insert = useCallback(
    (ch: string) => {
      const el = inputRef.current
      const start = el?.selectionStart ?? value.length
      const end = el?.selectionEnd ?? start
      let insertText = ch
      if (ch === 'x²') insertText = 'x²'
      else if (ch === TYPO_MINUS || ch === '\u2212')
        insertText = TYPO_MINUS
      else if (ch === '⌫') {
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

  return (
    <div className="math-keyboard" aria-label="Matematická klávesnice">
      <div className="math-keyboard__grid math-keyboard__grid--wide">
        {ROW_DIGITS.map((k, i) => (
          <button
            key={`d-${i}`}
            type="button"
            className="math-keyboard__key"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(k)}
          >
            {k}
          </button>
        ))}
        {ROW_REST.map((k, ci) => (
          <button
            key={`r-${ci}-${k}`}
            type="button"
            className={`math-keyboard__key${k === ' ' ? ' math-keyboard__key--wide' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(k)}
          >
            {k === ' ' ? (
              'mezera'
            ) : k === 'x' || k === 'x²' ? (
              <MathText text={k} />
            ) : (
              k
            )}
          </button>
        ))}
        <button
          type="button"
          className="math-keyboard__key math-keyboard__key--tool math-keyboard__key--span4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
        >
          Smazat vše
        </button>
      </div>
    </div>
  )
}
