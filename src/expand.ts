import { formatDisplayNumber, MUL_DOT, TYPO_MINUS } from './constants'
import { MAX_FACTOR_POLY_COEF } from './tasks'
import type { PolyUpTo3 } from './lib/parsePolyUpTo3'

export type ExpandKind = 'monomial' | 'polynomial'
export type ExpandLevel = 'basic' | 'advanced' | 'master'

export interface ExpandTask {
  id: string
  kind: ExpandKind
  level: ExpandLevel
  displayString: string
  expected: PolyUpTo3
}

export type { PolyUpTo3 }

const INNER = 9

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function randomNonZero(min: number, max: number): number {
  for (let i = 0; i < 40; i++) {
    const x = randomInt(min, max)
    if (x !== 0) return x
  }
  return 1
}

function polyFits(p: PolyUpTo3): boolean {
  const M = MAX_FACTOR_POLY_COEF
  return [p.a3, p.a2, p.a1, p.a0].every((c) => Math.abs(c) <= M)
}

/** ax² + bx + c */
function formatStandardPoly(d: number, e: number, f: number): string {
  const pieces: { coef: number; pow: 2 | 1 | 0 }[] = []
  if (d !== 0) pieces.push({ coef: d, pow: 2 })
  if (e !== 0) pieces.push({ coef: e, pow: 1 })
  if (f !== 0) pieces.push({ coef: f, pow: 0 })
  if (pieces.length === 0) return '0'
  let s = ''
  for (let i = 0; i < pieces.length; i++) {
    const { coef, pow } = pieces[i]!
    const abs = Math.abs(coef)
    let body = ''
    if (pow === 2) body = abs === 1 ? 'x²' : `${abs}x²`
    else if (pow === 1) body = abs === 1 ? 'x' : `${abs}x`
    else body = `${abs}`
    if (i === 0) s += coef < 0 ? `${TYPO_MINUS}${body}` : body
    else s += coef < 0 ? ` ${TYPO_MINUS} ${body}` : ` + ${body}`
  }
  return s
}

/** px + q, p ≠ 0 */
function formatLinearBinomial(p: number, q: number): string {
  let s = ''
  if (p === 1) s = 'x'
  else if (p === -1) s = `${TYPO_MINUS}x`
  else if (p > 0) s = `${p}x`
  else s = `${TYPO_MINUS}${Math.abs(p)}x`
  if (q !== 0) {
    if (q > 0) s += ` + ${q}`
    else s += ` ${TYPO_MINUS} ${Math.abs(q)}`
  }
  return s
}

function binomialProduct(p: number, q: number, r: number, s: number): PolyUpTo3 {
  return {
    a3: 0,
    a2: p * r,
    a1: p * s + q * r,
    a0: q * s,
  }
}

/** (ax+b)² — zobrazení (ax+b)·(ax+b) bez prostředního faktoru x */
function expandSameBinomialSquared(a: number, b: number): PolyUpTo3 {
  return binomialProduct(a, b, a, b)
}

/** (ax+b)(ax−b) */
function expandConjugateBinomials(a: number, b: number): PolyUpTo3 {
  return binomialProduct(a, b, a, -b)
}

type MonomialOuter = { type: 'k'; k: number } | { type: 'x'; sign: 1 | -1 }

function monomialOuterStr(outer: MonomialOuter, innerStr: string): string {
  if (outer.type === 'k')
    return `${formatDisplayNumber(outer.k)}${MUL_DOT}(${innerStr})`
  if (outer.sign === 1) return `x${MUL_DOT}(${innerStr})`
  return `${TYPO_MINUS}x${MUL_DOT}(${innerStr})`
}

function monomialTimesInner(
  outer: MonomialOuter,
  d: number,
  e: number,
  f: number
): PolyUpTo3 {
  if (outer.type === 'k') {
    const k = outer.k
    return { a3: 0, a2: k * d, a1: k * e, a0: k * f }
  }
  const sg = outer.sign
  return { a3: sg * d, a2: sg * e, a1: sg * f, a0: 0 }
}

/** Vnitřek závorky u jednočlenu je jen lineární (ex + f), bez x². */
function linearInnerHasNegative(e: number, f: number): boolean {
  return e < 0 || f < 0
}

function linearInnerAllNonNegative(e: number, f: number): boolean {
  return e >= 0 && f >= 0 && (e !== 0 || f !== 0)
}

/** Základní mnohočlen: (ax+b)·(ax+b) nebo (x+a)·(x+b), všechny koeficienty kladné. */
function generatePolynomialBasic(id: string): ExpandTask | null {
  for (let attempt = 0; attempt < 420; attempt++) {
    if (Math.random() < 0.5) {
      const a = randomInt(1, INNER)
      const b = randomInt(1, INNER)
      const expected = expandSameBinomialSquared(a, b)
      if (!polyFits(expected)) continue
      const inner = formatLinearBinomial(a, b)
      return {
        id,
        kind: 'polynomial',
        level: 'basic',
        displayString: `(${inner})${MUL_DOT}(${inner})`,
        expected,
      }
    }
    const a = randomInt(1, INNER)
    const b = randomInt(1, INNER)
    const expected = binomialProduct(1, a, 1, b)
    if (!polyFits(expected)) continue
    return {
      id,
      kind: 'polynomial',
      level: 'basic',
      displayString: `(${formatLinearBinomial(1, a)})${MUL_DOT}(${formatLinearBinomial(1, b)})`,
      expected,
    }
  }
  return null
}

/**
 * Pokročilý: (ax+b)·(ax+b) s a > 0 a záporným b; nebo (x+a)·(x−b); (ax+b)·(ax−b);
 * nebo součin dvou dvojčlenů se všemi kladnými koeficienty.
 */
function generatePolynomialAdvanced(id: string): ExpandTask | null {
  for (let attempt = 0; attempt < 520; attempt++) {
    const variant = randomInt(0, 3)
    if (variant === 0) {
      const a = randomInt(1, INNER)
      const b = randomInt(-INNER, -1)
      const expected = expandSameBinomialSquared(a, b)
      if (!polyFits(expected)) continue
      const inner = formatLinearBinomial(a, b)
      return {
        id,
        kind: 'polynomial',
        level: 'advanced',
        displayString: `(${inner})${MUL_DOT}(${inner})`,
        expected,
      }
    }
    if (variant === 1) {
      const a = randomInt(1, INNER)
      const b = randomInt(1, INNER)
      const expected = binomialProduct(1, a, 1, -b)
      if (!polyFits(expected)) continue
      return {
        id,
        kind: 'polynomial',
        level: 'advanced',
        displayString: `(${formatLinearBinomial(1, a)})${MUL_DOT}(${formatLinearBinomial(1, -b)})`,
        expected,
      }
    }
    if (variant === 2) {
      const a = randomInt(1, INNER)
      const b = randomInt(1, INNER)
      const expected = expandConjugateBinomials(a, b)
      if (!polyFits(expected)) continue
      return {
        id,
        kind: 'polynomial',
        level: 'advanced',
        displayString: `(${formatLinearBinomial(a, b)})${MUL_DOT}(${formatLinearBinomial(a, -b)})`,
        expected,
      }
    }
    const p = randomInt(1, INNER)
    const r = randomInt(1, INNER)
    const q = randomInt(1, INNER)
    const s = randomInt(1, INNER)
    const expected = binomialProduct(p, q, r, s)
    if (!polyFits(expected)) continue
    return {
      id,
      kind: 'polynomial',
      level: 'advanced',
      displayString: `(${formatLinearBinomial(p, q)})${MUL_DOT}(${formatLinearBinomial(r, s)})`,
      expected,
    }
  }
  return null
}

/**
 * Mistr: (ax+b)·(ax+b) se záporným a, nebo libovolný dvojčlen · dvojčlen s alespoň jedním záporným koeficientem.
 */
function generatePolynomialMaster(id: string): ExpandTask | null {
  for (let attempt = 0; attempt < 520; attempt++) {
    if (Math.random() < 0.45) {
      const a = -randomInt(1, INNER)
      const b = randomInt(-INNER, INNER)
      const expected = expandSameBinomialSquared(a, b)
      if (!polyFits(expected)) continue
      const inner = formatLinearBinomial(a, b)
      return {
        id,
        kind: 'polynomial',
        level: 'master',
        displayString: `(${inner})${MUL_DOT}(${inner})`,
        expected,
      }
    }
    const p = randomNonZero(-INNER, INNER)
    const r = randomNonZero(-INNER, INNER)
    const q = randomInt(-INNER, INNER)
    const s = randomInt(-INNER, INNER)
    if (p > 0 && q > 0 && r > 0 && s > 0) continue
    const expected = binomialProduct(p, q, r, s)
    if (!polyFits(expected)) continue
    return {
      id,
      kind: 'polynomial',
      level: 'master',
      displayString: `(${formatLinearBinomial(p, q)})${MUL_DOT}(${formatLinearBinomial(r, s)})`,
      expected,
    }
  }
  return null
}

function generateMonomial(level: ExpandLevel, id: string): ExpandTask | null {
  const d = 0
  for (let attempt = 0; attempt < 320; attempt++) {
    let outer: MonomialOuter
    let e: number
    let f: number

    if (level === 'basic') {
      outer =
        Math.random() < 0.5
          ? { type: 'k', k: randomInt(2, INNER) }
          : { type: 'x', sign: 1 }
      e = randomInt(0, INNER)
      f = randomInt(0, INNER)
      if (!linearInnerAllNonNegative(e, f)) continue
    } else if (level === 'advanced') {
      outer =
        Math.random() < 0.5
          ? { type: 'k', k: randomInt(2, INNER) }
          : { type: 'x', sign: 1 }
      e = randomInt(-INNER, INNER)
      f = randomInt(-INNER, INNER)
      if (e === 0 && f === 0) continue
      if (!linearInnerHasNegative(e, f)) continue
    } else {
      outer =
        Math.random() < 0.5
          ? { type: 'k', k: -randomInt(2, INNER) }
          : { type: 'x', sign: -1 }
      e = randomInt(-INNER, INNER)
      f = randomInt(-INNER, INNER)
      if (e === 0 && f === 0) continue
    }

    const expected = monomialTimesInner(outer, d, e, f)
    if (!polyFits(expected)) continue

    const innerStr = formatStandardPoly(d, e, f)
    const displayString = monomialOuterStr(outer, innerStr)
    return { id, kind: 'monomial', level, displayString, expected }
  }
  return null
}

function fallbackMonomial(level: ExpandLevel, id: string): ExpandTask {
  const innerStr = formatStandardPoly(0, 1, 3)
  if (level === 'master') {
    return {
      id,
      kind: 'monomial',
      level,
      displayString: `${formatDisplayNumber(-2)}${MUL_DOT}(${innerStr})`,
      expected: { a3: 0, a2: 0, a1: -2, a0: -6 },
    }
  }
  if (level === 'advanced') {
    return {
      id,
      kind: 'monomial',
      level,
      displayString: `3${MUL_DOT}(${formatStandardPoly(0, 1, -1)})`,
      expected: { a3: 0, a2: 0, a1: 3, a0: -3 },
    }
  }
  return {
    id,
    kind: 'monomial',
    level,
    displayString: `2${MUL_DOT}(${innerStr})`,
    expected: { a3: 0, a2: 0, a1: 2, a0: 6 },
  }
}

function fallbackPolynomial(
  level: ExpandLevel,
  id: string
): ExpandTask {
  if (level === 'master') {
    return {
      id,
      kind: 'polynomial',
      level: 'master',
      displayString: `(${formatLinearBinomial(1, 1)})${MUL_DOT}(${formatLinearBinomial(1, -2)})`,
      expected: binomialProduct(1, 1, 1, -2),
    }
  }
  if (level === 'advanced') {
    return {
      id,
      kind: 'polynomial',
      level: 'advanced',
      displayString: `(${formatLinearBinomial(2, -1)})${MUL_DOT}(${formatLinearBinomial(2, -1)})`,
      expected: expandSameBinomialSquared(2, -1),
    }
  }
  return {
    id,
    kind: 'polynomial',
    level: 'basic',
    displayString: `(${formatLinearBinomial(2, 1)})${MUL_DOT}(${formatLinearBinomial(2, 1)})`,
    expected: expandSameBinomialSquared(2, 1),
  }
}

export function generateExpandTask(
  kind: ExpandKind,
  level: ExpandLevel
): ExpandTask {
  const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  if (kind === 'monomial') {
    const t = generateMonomial(level, id)
    return t ?? fallbackMonomial(level, id)
  }

  if (level === 'basic') {
    const t = generatePolynomialBasic(id)
    return t ?? fallbackPolynomial('basic', id)
  }
  if (level === 'advanced') {
    const t = generatePolynomialAdvanced(id)
    return t ?? fallbackPolynomial('advanced', id)
  }
  const t = generatePolynomialMaster(id)
  return t ?? fallbackPolynomial('master', id)
}
