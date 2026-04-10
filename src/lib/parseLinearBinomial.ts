/**
 * Parsuje výraz px + q (mezery, Unicode minus, x, x^2 zakázáno).
 */

import { UNICODE_MINUS_LIKE_RE } from '../constants'

function parseOneSignedTerm(
  raw: string
): { coef: number; pow: 0 | 1 } | null {
  if (!raw) return null
  const sign = raw[0] === '-' ? -1 : 1
  const body = raw.slice(1)
  if (!body) return null

  const norm = body.replace(/\^2/gi, '²')
  if (norm.includes('²') || /x2$/i.test(norm)) return null

  if (/x/i.test(norm)) {
    const coefPart = norm.replace(/x/gi, '').trim()
    const coef =
      coefPart === '' ? 1 : Number(coefPart.replace(UNICODE_MINUS_LIKE_RE, '-'))
    if (!Number.isFinite(coef)) return null
    return { coef: sign * coef, pow: 1 }
  }
  const n = Number(body.replace(UNICODE_MINUS_LIKE_RE, '-').replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return { coef: sign * n, pow: 0 }
}

/** w·x + k; u konstanty „5“ je w = 0, k = 5. */
export function parseLinearBinomial(input: string): {
  w: number
  k: number
} | null {
  let s = input
    .trim()
    .replace(UNICODE_MINUS_LIKE_RE, '-')
    .replace(/\u00B7/g, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
  if (!s) return null

  s = s.replace(/\^2/gi, '²')
  if (s.includes('²')) return null

  if (!/^[+-]/.test(s)) s = `+${s}`

  const rawTerms = s.match(/[+-][^+-]*/g)
  if (!rawTerms || rawTerms.length === 0) return null

  let w = 0
  let k = 0

  for (const t of rawTerms) {
    const p = parseOneSignedTerm(t)
    if (!p) return null
    if (p.pow === 1) w += p.coef
    else k += p.coef
  }

  return { w, k }
}
