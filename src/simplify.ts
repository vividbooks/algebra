import { TYPO_MINUS } from './constants'

export type SimplifyLevel = 'basic' | 'advanced' | 'master'

export interface SimplifyTask {
  id: string
  /** Zobrazení jako součet více členů, např. 2x² - 3x + 5 + 2x - 7 */
  displayString: string
  a: number
  b: number
  c: number
}

type Term = { coef: number; pow: 0 | 1 | 2 }

/** Žádný zobrazovaný člen ani cílové a, b, c nepřekročí tuto absolutní hodnotu. */
export const MAX_SIMPLIFY_COEF = 9

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function randomChoice<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)]!
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Rozloží n na `parts` sčítanců; každý má absolutní hodnotu ≤ MAX_SIMPLIFY_COEF.
 */
function splitIntoSumBounded(n: number, parts: number): number[] {
  const M = MAX_SIMPLIFY_COEF
  if (parts <= 1 || Math.abs(n) > parts * M) {
    return [n]
  }
  for (let attempt = 0; attempt < 800; attempt++) {
    const out: number[] = []
    for (let i = 0; i < parts - 1; i++) {
      out.push(randomInt(-M, M))
    }
    const last = n - out.reduce((s, v) => s + v, 0)
    if (Math.abs(last) <= M) {
      out.push(last)
      return out
    }
  }
  return [n]
}

function termToPiece(coef: number, pow: 0 | 1 | 2): { sign: '-' | '+'; body: string } {
  const abs = Math.abs(coef)
  let body = ''
  if (pow === 2) {
    body = abs === 1 ? 'x²' : `${abs}x²`
  } else if (pow === 1) {
    body = abs === 1 ? 'x' : `${abs}x`
  } else {
    body = `${abs}`
  }
  return { sign: coef < 0 ? '-' : '+', body }
}

function termsToDisplayString(terms: Term[]): string {
  if (terms.length === 0) return '0'
  const parts: string[] = []
  for (let i = 0; i < terms.length; i++) {
    const { sign, body } = termToPiece(terms[i].coef, terms[i].pow)
    if (i === 0) {
      parts.push(sign === '-' ? `${TYPO_MINUS}${body}` : body)
    } else {
      parts.push(sign === '-' ? ` ${TYPO_MINUS} ${body}` : ` + ${body}`)
    }
  }
  return parts.join('')
}

/** Po sobě jdoucí neprázdné úseky; `k` v rozsahu 1..n. */
function splitIntoChunks<T>(arr: T[], k: number): T[][] {
  const n = arr.length
  if (n === 0) return []
  k = Math.max(1, Math.min(k, n))
  if (k === 1) return [arr]
  const cutChoices = shuffle(
    Array.from({ length: n - 1 }, (_, i) => i + 1)
  ).slice(0, k - 1) as number[]
  cutChoices.sort((x, y) => x - y)
  const chunks: T[][] = []
  let start = 0
  for (const cut of cutChoices) {
    chunks.push(arr.slice(start, cut))
    start = cut
  }
  chunks.push(arr.slice(start))
  return chunks
}

function chunkToABC(chunk: Term[]): { a: number; b: number; c: number } {
  let a = 0
  let b = 0
  let c = 0
  for (const t of chunk) {
    if (t.pow === 2) a += t.coef
    else if (t.pow === 1) b += t.coef
    else c += t.coef
  }
  return { a, b, c }
}

/** Pravděpodobnost „− ( …“ před další závorkou (mistr). */
const MINUS_BEFORE_PAREN_PROB = 0.82

/** Mistr: 2–3 závorky, mezi nimi velmi často minus před závorkou; a,b,c podle znamének. */
function masterDisplayWithSignedGroups(shuffled: Term[]): {
  displayString: string
  a: number
  b: number
  c: number
} {
  if (shuffled.length === 0) {
    return { displayString: '0', a: 0, b: 0, c: 0 }
  }
  const k =
    shuffled.length === 1 ? 1 : Math.min(randomChoice([2, 3]), shuffled.length)
  const chunks = splitIntoChunks(shuffled, k)

  const ops: ('+' | '-')[] = []
  for (let i = 0; i < k - 1; i++) {
    ops.push(Math.random() < MINUS_BEFORE_PAREN_PROB ? '-' : '+')
  }

  const v0 = chunkToABC(chunks[0]!)
  let a = v0.a
  let b = v0.b
  let c = v0.c
  for (let j = 1; j < chunks.length; j++) {
    const sign = ops[j - 1] === '-' ? -1 : 1
    const v = chunkToABC(chunks[j]!)
    a += sign * v.a
    b += sign * v.b
    c += sign * v.c
  }

  let displayString = `(${termsToDisplayString(chunks[0]!)})`
  for (let j = 1; j < chunks.length; j++) {
    const op = ops[j - 1] === '-' ? ` ${TYPO_MINUS} ` : ' + '
    displayString += `${op}(${termsToDisplayString(chunks[j]!)})`
  }

  return { displayString, a, b, c }
}

/**
 * Náhodný součet členů (stupeň nejvýše 2), který se po sloučení dá na ax² + bx + c.
 *
 * **Základní** — jen x² + … s kladnými čísly, málo členů.
 * **Pokročilý** — ax² + …, více členů; všude |koef.| ≤ MAX_SIMPLIFY_COEF.
 * **Mistr** — stejné členy jako pokročilý; zadání jako součet 2–3 závorek, často „− (…“.
 */
export function generateSimplifyTask(
  level: SimplifyLevel = 'advanced'
): SimplifyTask {
  const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  let a: number
  let b: number
  let c: number
  let bPartOptions: number[]
  let cPartOptions: number[]
  let splitX2Prob: number

  switch (level) {
    case 'basic':
      a = 1
      b = randomInt(1, MAX_SIMPLIFY_COEF)
      c = randomInt(1, MAX_SIMPLIFY_COEF)
      bPartOptions = [2]
      cPartOptions = [2]
      splitX2Prob = 0
      break
    case 'advanced':
    case 'master':
      a = randomInt(1, 4)
      b = randomInt(-MAX_SIMPLIFY_COEF, MAX_SIMPLIFY_COEF)
      c = randomInt(-MAX_SIMPLIFY_COEF, MAX_SIMPLIFY_COEF)
      bPartOptions = [2, 3, 4]
      cPartOptions = [2, 3, 4]
      splitX2Prob = 0.4
      break
  }

  const terms: Term[] = []

  if (Math.random() < splitX2Prob && a >= 2) {
    const a1 = randomInt(1, a - 1)
    terms.push({ coef: a1, pow: 2 }, { coef: a - a1, pow: 2 })
  } else {
    terms.push({ coef: a, pow: 2 })
  }

  const bCount = randomChoice(bPartOptions)
  splitIntoSumBounded(b, bCount).forEach((coef) => {
    if (coef !== 0) terms.push({ coef, pow: 1 })
  })

  const cCount = randomChoice(cPartOptions)
  splitIntoSumBounded(c, cCount).forEach((coef) => {
    if (coef !== 0) terms.push({ coef, pow: 0 })
  })

  const shuffled = shuffle(terms)
  let displayString: string
  if (level === 'master') {
    const m = masterDisplayWithSignedGroups(shuffled)
    displayString = m.displayString
    a = m.a
    b = m.b
    c = m.c
  } else {
    displayString = termsToDisplayString(shuffled)
  }

  return {
    id,
    displayString,
    a,
    b,
    c,
  }
}
