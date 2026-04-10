import type { ReactNode } from 'react'

/**
 * Vykreslí řetězec tak, že každá proměnná x (nebo X) je kurzívou; u x² je kurzívou jen písmeno x.
 */
export function MathText({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]!
    if (ch === 'x' || ch === 'X') {
      if (text[i + 1] === '²') {
        out.push(
          <i key={key++} className="math-var">
            {ch}
          </i>,
          '²'
        )
        i += 2
      } else {
        out.push(
          <i key={key++} className="math-var">
            {ch}
          </i>
        )
        i += 1
      }
    } else {
      let j = i + 1
      while (j < n && text[j] !== 'x' && text[j] !== 'X') j++
      out.push(text.slice(i, j))
      i = j
    }
  }

  return <>{out}</>
}
