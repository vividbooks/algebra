import { TYPO_MINUS } from './constants'

export type FactorLevel = 'basic' | 'advanced' | 'master'

/**
 * Mez pro režim roznásobování (očekávaný polynom) — neměnit bez úpravy expand úloh.
 */
export const MAX_FACTOR_POLY_COEF = 20

/** Rozklad na součin: |a|, |b|, |c| jsou vždy menší než 17 (max. 16). */
const MAX_FACTOR_TASK_POLY_COEF = 16

export interface FactorTask {
  id: string
  title: string
  /** Koeficient u x² (celé číslo ≥ 1). Zobrazí se jako x² nebo ax². */
  a: number
  b: number
  c: number
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function randomChoice<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)]!
}

function polyCoefsWithinMax(a: number, b: number, c: number): boolean {
  return (
    Math.abs(a) <= MAX_FACTOR_TASK_POLY_COEF &&
    Math.abs(b) <= MAX_FACTOR_TASK_POLY_COEF &&
    Math.abs(c) <= MAX_FACTOR_TASK_POLY_COEF
  )
}

/** (mx + n)² = m²x² + 2mnx + n² — vše v mezi MAX; dlaždicově čtverec. */
function basicPerfectSquareMNPool(): { m: number; n: number }[] {
  const M = MAX_FACTOR_TASK_POLY_COEF
  const pool: { m: number; n: number }[] = []
  for (let m = 1; m * m <= M; m++) {
    for (let n = 1; n <= M; n++) {
      const a = m * m
      const b = 2 * m * n
      const c = n * n
      if (a <= M && b <= M && c <= M) pool.push({ m, n })
      if (b > M || c > M) break
    }
  }
  return pool
}

/** m²x² − n² = (mx − n)(mx + n) — jen pro pokročilou úroveň (záporná konstanta). */
function diffSquareMNPool(): { m: number; n: number }[] {
  const M = MAX_FACTOR_TASK_POLY_COEF
  const pool: { m: number; n: number }[] = []
  for (let m = 1; m * m <= M; m++) {
    for (let n = 1; n * n <= M; n++) {
      pool.push({ m, n })
    }
  }
  return pool
}

const BASIC_PERFECT_SQUARE_MN = basicPerfectSquareMNPool()
const DIFF_SQUARE_MN = diffSquareMNPool()

/**
 * Vytýkání — základní: g(x+p)(x+q) = g x² + g(p+q)x + g p q nebo (g x)(x+r),
 * všechny koeficienty a, b, c ≥ 0 (a > 0).
 */
function generateBasicFactoringOutCommonFactor(id: string): FactorTask | null {
  const M = MAX_FACTOR_TASK_POLY_COEF
  if (Math.random() < 0.44) {
    const g = randomInt(2, Math.min(8, M))
    const rMax = Math.min(M, Math.floor(M / g))
    if (rMax < 1) return null
    const r = randomInt(1, rMax)
    const a = g
    const b = g * r
    const c = 0
    if (!polyCoefsWithinMax(a, b, c)) return null
    return {
      id,
      title: formatPolynomialParts(a, b, c),
      a,
      b,
      c,
    }
  }
  for (let t = 0; t < 160; t++) {
    const g = randomInt(2, Math.min(8, M))
    const p = randomInt(1, M)
    const q = randomInt(1, M)
    const a = g
    const b = g * (p + q)
    const c = g * p * q
    if (polyCoefsWithinMax(a, b, c)) {
      return {
        id,
        title: formatPolynomialParts(a, b, c),
        a,
        b,
        c,
      }
    }
  }
  return null
}

/**
 * Vytýkání — pokročilý: alespoň jeden z b, c záporný (a > 0).
 * Buď (g x)(x − r), nebo g(x+p)(x−q) s p,q ≥ 1 ⇒ c = −g p q < 0.
 */
function generateAdvancedFactoringOutCommonFactor(id: string): FactorTask | null {
  const M = MAX_FACTOR_TASK_POLY_COEF
  if (randomInt(0, 1) === 0) {
    const g = randomInt(2, Math.min(8, M))
    const rMax = Math.floor(M / g)
    if (rMax < 1) return null
    const r = randomInt(1, rMax)
    const a = g
    const b = -g * r
    const c = 0
    if (!polyCoefsWithinMax(a, b, c) || b >= 0) return null
    return {
      id,
      title: formatPolynomialParts(a, b, c),
      a,
      b,
      c,
    }
  }
  for (let t = 0; t < 180; t++) {
    const g = randomInt(2, Math.min(7, M))
    const p = randomInt(1, M)
    const q = randomInt(1, M)
    const a = g
    const b = g * (p - q)
    const c = -g * p * q
    if (!polyCoefsWithinMax(a, b, c)) continue
    return {
      id,
      title: formatPolynomialParts(a, b, c),
      a,
      b,
      c,
    }
  }
  return null
}

/** Všechny dvojice (w₁, w₂) kladných celých čísel s w₁·w₂ = a. */
function factorPairs(a: number): [number, number][] {
  const out: [number, number][] = []
  for (let d = 1; d * d <= a; d++) {
    if (a % d === 0) out.push([d, a / d])
  }
  return out
}

function pickBasicPerfectSquareTask(id: string): FactorTask {
  const { m, n } = randomChoice(BASIC_PERFECT_SQUARE_MN)
  const a = m * m
  const b = 2 * m * n
  const c = n * n
  return {
    id,
    title: formatPolynomialParts(a, b, c),
    a,
    b,
    c,
  }
}

/**
 * Základní: dokonalý čtverec nebo vytýkání — trojčlen má a, b, c vždy ≥ 0.
 */
function generateBasicFactorTask(id: string): FactorTask {
  if (randomInt(0, 2) === 0) {
    const fact = generateBasicFactoringOutCommonFactor(id)
    if (fact) return fact
  }
  if (Math.random() < 0.5) {
    return pickBasicPerfectSquareTask(id)
  }
  const fact = generateBasicFactoringOutCommonFactor(id)
  if (fact) return fact
  return pickBasicPerfectSquareTask(id)
}

/**
 * Pokročilý: rozdíl čtverců, klasický rozklad (kladné členy), nebo vytýkání
 * s alespoň jedním záporným členem.
 */
function generateAdvancedFactorTask(id: string): FactorTask {
  if (randomInt(0, 3) === 0) {
    const { m, n } = randomChoice(DIFF_SQUARE_MN)
    const a = m * m
    const c = -(n * n)
    if (polyCoefsWithinMax(a, 0, c)) {
      return {
        id,
        title: formatPolynomialParts(a, 0, c),
        a,
        b: 0,
        c,
      }
    }
  }
  if (randomInt(0, 1) === 0) {
    const fact = generateAdvancedFactoringOutCommonFactor(id)
    if (fact) return fact
  }
  const a = randomChoice([2, 2, 3, 3, 4, 4, 4])
  const pairs = factorPairs(a)
  const M = MAX_FACTOR_TASK_POLY_COEF

  for (let attempt = 0; attempt < 250; attempt++) {
    const [w1, w2] = randomChoice(pairs)
    const k1 = randomInt(1, M)
    const k2 = randomInt(1, M)
    const b = w1 * k2 + w2 * k1
    const c = k1 * k2
    if (b > 0 && c > 0 && polyCoefsWithinMax(a, b, c)) {
      return {
        id,
        title: formatPolynomialParts(a, b, c),
        a,
        b,
        c,
      }
    }
  }

  for (const [w1, w2] of pairs) {
    for (let k1 = 1; k1 <= M; k1++) {
      for (let k2 = 1; k2 <= M; k2++) {
        const b = w1 * k2 + w2 * k1
        const c = k1 * k2
        if (b > 0 && c > 0 && polyCoefsWithinMax(a, b, c)) {
          return {
            id,
            title: formatPolynomialParts(a, b, c),
            a,
            b,
            c,
          }
        }
      }
    }
  }

  const [w1, w2] = pairs[0]!
  const b = w1 + w2
  return {
    id,
    title: formatPolynomialParts(a, b, 1),
    a,
    b,
    c: 1,
  }
}

/**
 * Mistr: jako dříve — k₁, k₂ mohou být záporné, libovolné rozumné a.
 */
function generateMasterFactorTask(id: string): FactorTask {
  const a = randomChoice([1, 1, 1, 2, 2, 3, 3, 4])
  const pairs = factorPairs(a)
  const M = MAX_FACTOR_TASK_POLY_COEF

  for (let attempt = 0; attempt < 400; attempt++) {
    const [w1, w2] = randomChoice(pairs)
    const k1 = randomInt(-M, M)
    const k2 = randomInt(-M, M)
    if (k1 === 0 && k2 === 0) continue
    const b = w1 * k2 + w2 * k1
    const c = k1 * k2
    if (polyCoefsWithinMax(a, b, c)) {
      return {
        id,
        title: formatPolynomialParts(a, b, c),
        a,
        b,
        c,
      }
    }
  }

  for (const [w1, w2] of pairs) {
    for (let k1 = -M; k1 <= M; k1++) {
      for (let k2 = -M; k2 <= M; k2++) {
        if (k1 === 0 && k2 === 0) continue
        const b = w1 * k2 + w2 * k1
        const c = k1 * k2
        if (polyCoefsWithinMax(a, b, c)) {
          return {
            id,
            title: formatPolynomialParts(a, b, c),
            a,
            b,
            c,
          }
        }
      }
    }
  }

  return {
    id,
    title: formatPolynomialParts(1, 3, 2),
    a: 1,
    b: 3,
    c: 2,
  }
}

export function generateFactorTask(level: FactorLevel): FactorTask {
  const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  switch (level) {
    case 'basic':
      return generateBasicFactorTask(id)
    case 'advanced':
      return generateAdvancedFactorTask(id)
    case 'master':
      return generateMasterFactorTask(id)
  }
}

/** Levá strana ax² + bx + c (x² nebo ax²). */
export function formatPolynomialParts(a: number, b: number, c: number): string {
  let s = ''
  if (a < 1 || !Number.isInteger(a)) {
    s = '?x²'
  } else if (a === 1) {
    s = 'x²'
  } else {
    s = `${a}x²`
  }
  if (b === 1) s += ' + x'
  else if (b === -1) s += ` ${TYPO_MINUS} x`
  else if (b > 0) s += ` + ${b}x`
  else if (b < 0) s += ` ${TYPO_MINUS} ${Math.abs(b)}x`
  if (c > 0) s += ` + ${c}`
  else if (c < 0) s += ` ${TYPO_MINUS} ${Math.abs(c)}`
  return s
}

export function formatPolynomial(task: FactorTask): string {
  return formatPolynomialParts(task.a, task.b, task.c)
}

/** Ověří (w₁x + k₁)(w₂x + k₂) == ax² + bx + c pro daná celá čísla. */
export function matchesFactorization(
  a: number,
  b: number,
  c: number,
  w1: number,
  k1: number,
  w2: number,
  k2: number
): boolean {
  return (
    w1 * w2 === a &&
    w1 * k2 + w2 * k1 === b &&
    k1 * k2 === c
  )
}
