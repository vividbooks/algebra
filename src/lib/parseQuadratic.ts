/**
 * Parsuje zjednodušený kvadratický výraz (jen x², x a konstanta) z řetězce.
 * Podporuje x², x^2, mezery, Unicode minus.
 */

import { UNICODE_MINUS_LIKE_RE } from '../constants'

export interface QuadCoeffs {
  a: number
  b: number
  c: number
}

function parseOneSignedTerm(raw: string): { c: number; p: 0 | 1 | 2 } | null {
  if (!raw) return null
  const sign = raw[0] === '-' ? -1 : 1
  const body = raw.slice(1)
  if (!body) return null

  const norm = body.replace(/\^2/gi, '²')
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

export function parseQuadratic(input: string): QuadCoeffs | null {
  let s = input
    .trim()
    .replace(UNICODE_MINUS_LIKE_RE, '-')
    .replace(/\u00B7/g, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
  if (!s) return null

  s = s.replace(/\^2/gi, '²')

  if (!/^[+-]/.test(s)) s = `+${s}`

  const rawTerms = s.match(/[+-][^+-]*/g)
  if (!rawTerms || rawTerms.length === 0) return null

  let a = 0
  let b = 0
  let c0 = 0

  for (const t of rawTerms) {
    const p = parseOneSignedTerm(t)
    if (!p) return null
    if (p.p === 2) a += p.c
    else if (p.p === 1) b += p.c
    else c0 += p.c
  }

  return { a, b: b, c: c0 }
}

export function quadraticsEqual(
  u: QuadCoeffs | null,
  v: QuadCoeffs | null
): boolean {
  if (!u || !v) return false
  return u.a === v.a && u.b === v.b && u.c === v.c
}
