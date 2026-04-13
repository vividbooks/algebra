/**
 * Parsuje polynom v x až stupně 3 (členy x³, x², x, konstanta).
 */

import { TYPO_MINUS, UNICODE_MINUS_LIKE_RE } from '../constants'

export type PolyUpTo3 = {
  a3: number
  a2: number
  a1: number
  a0: number
}

function parseOneSignedTerm(
  raw: string
): { c: number; p: 0 | 1 | 2 | 3 } | null {
  if (!raw) return null
  const sign = raw[0] === '-' ? -1 : 1
  const body = raw.slice(1)
  if (!body) return null

  let norm = body.replace(/\^3/gi, '³').replace(/\^2/gi, '²')

  if (/x³|x\s*\^?\s*³/i.test(norm) || /³\s*x/i.test(norm)) {
    const coefPart = norm.replace(/x³|x\s*\^?\s*³/gi, '').replace(/³\s*x/gi, '').trim()
    const coef =
      coefPart === '' ? 1 : Number(coefPart.replace(UNICODE_MINUS_LIKE_RE, '-'))
    if (!Number.isFinite(coef)) return null
    return { c: sign * coef, p: 3 }
  }
  if (norm.includes('²') || /x2$/i.test(norm)) {
    const coefPart = norm.replace(/x²|x2/gi, '').trim()
    const coef =
      coefPart === '' ? 1 : Number(coefPart.replace(UNICODE_MINUS_LIKE_RE, '-'))
    if (!Number.isFinite(coef)) return null
    return { c: sign * coef, p: 2 }
  }
  if (/x/i.test(norm)) {
    const coefPart = norm.replace(/x/gi, '').trim()
    const coef =
      coefPart === '' ? 1 : Number(coefPart.replace(UNICODE_MINUS_LIKE_RE, '-'))
    if (!Number.isFinite(coef)) return null
    return { c: sign * coef, p: 1 }
  }
  const n = Number(body.replace(UNICODE_MINUS_LIKE_RE, '-').replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return { c: sign * n, p: 0 }
}

export function parsePolynomialUpTo3(input: string): PolyUpTo3 | null {
  let s = input
    .trim()
    .replace(UNICODE_MINUS_LIKE_RE, '-')
    .replace(/\u00B7/g, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
  if (!s) return null

  s = s.replace(/\^3/gi, '³').replace(/\^2/gi, '²')

  if (!/^[+-]/.test(s)) s = `+${s}`

  const rawTerms = s.match(/[+-][^+-]*/g)
  if (!rawTerms || rawTerms.length === 0) return null

  let a3 = 0
  let a2 = 0
  let a1 = 0
  let a0 = 0

  for (const t of rawTerms) {
    const p = parseOneSignedTerm(t)
    if (!p) return null
    if (p.p === 3) a3 += p.c
    else if (p.p === 2) a2 += p.c
    else if (p.p === 1) a1 += p.c
    else a0 += p.c
  }

  return { a3, a2, a1, a0 }
}

export function polyUpTo3Equal(u: PolyUpTo3 | null, v: PolyUpTo3 | null): boolean {
  if (!u || !v) return false
  return (
    u.a3 === v.a3 &&
    u.a2 === v.a2 &&
    u.a1 === v.a1 &&
    u.a0 === v.a0
  )
}

export type PolyUpTo3Chunk = { plus: boolean; text: string }

/**
 * Nenulové členy polynomu ve standardním pořadí (x³ … konstanta), pro barevné vykreslení nebo zápis.
 */
export function polyUpTo3Chunks(p: PolyUpTo3): PolyUpTo3Chunk[] {
  const chunks: PolyUpTo3Chunk[] = []
  const push = (coef: number, pow: 0 | 1 | 2 | 3) => {
    if (coef === 0) return
    const plus = coef > 0
    const c = Math.abs(coef)
    let text = ''
    if (pow === 3) text = c === 1 ? 'x³' : `${c}x³`
    else if (pow === 2) text = c === 1 ? 'x²' : `${c}x²`
    else if (pow === 1) text = c === 1 ? 'x' : `${c}x`
    else text = String(c)
    chunks.push({ plus, text })
  }
  push(p.a3, 3)
  push(p.a2, 2)
  push(p.a1, 1)
  push(p.a0, 0)
  return chunks
}

/**
 * Čitelný zápis polynomu (např. pro náhled z dlaždic) — stejná typografie mínusu jako ve výrazech úloh.
 */
export function formatPolyUpTo3Expr(p: PolyUpTo3): string {
  const chunks = polyUpTo3Chunks(p)
  if (chunks.length === 0) return '0'
  let s = ''
  for (let i = 0; i < chunks.length; i++) {
    const { plus, text } = chunks[i]!
    if (i === 0) {
      s = plus ? text : `${TYPO_MINUS} ${text}`
    } else {
      s += plus ? ` + ${text}` : ` ${TYPO_MINUS} ${text}`
    }
  }
  return s
}
