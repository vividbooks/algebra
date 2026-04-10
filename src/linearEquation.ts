import { formatDisplayNumber, MUL_DOT, TYPO_MINUS } from './constants'

/** Úroveň obtížnosti režimu Rovnice. */
export type EquationLevel = 'basic' | 'advanced' | 'master'

export type EquationTask =
  | {
      level: 'basic'
      id: string
      a: number
      b: number
      rhs: number
    }
  | {
      level: 'advanced'
      id: string
      a: number
      b: number
      c: number
      d: number
    }
  | {
      level: 'master'
      id: string
      k: number
      m: number
      n: number
      rhs: number
    }

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function newId(): string {
  return `lin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Všechna zobrazená celá čísla v zadání mají |n| ≤ tohoto (tj. menší než 11). */
const MAX_ABS = 10

/** Levá strana ax + b jako čitelný řetězec (a může být 0 u pokročilé úrovně). */
export function formatLinearLhs(a: number, b: number): string {
  let lhs = ''
  if (a === 1) lhs = 'x'
  else if (a === -1) lhs = `${TYPO_MINUS}x`
  else if (a < 0) lhs = `${TYPO_MINUS}${Math.abs(a)}x`
  else if (a > 0) lhs = `${a}x`

  if (a !== 0) {
    if (b > 0) lhs += ` + ${b}`
    else if (b < 0) lhs += ` ${TYPO_MINUS} ${Math.abs(b)}`
  } else {
    if (b > 0) lhs = `${b}`
    else if (b < 0) lhs = `${TYPO_MINUS}${Math.abs(b)}`
    else lhs = '0'
  }
  return lhs
}

/** Levá strana k(mx + n) se závorkou (|k| ≥ 2 u generátoru mistr). */
export function formatFactoredLhs(k: number, m: number, n: number): string {
  const inner = formatLinearLhs(m, n)
  if (k === 1) return `(${inner})`
  if (k === -1) return `${TYPO_MINUS}(${inner})`
  if (k > 0) return `${k}${MUL_DOT}(${inner})`
  return `${TYPO_MINUS}${Math.abs(k)}${MUL_DOT}(${inner})`
}

export function formatEquationDisplay(task: EquationTask): string {
  switch (task.level) {
    case 'basic':
      return `${formatLinearLhs(task.a, task.b)} = ${formatDisplayNumber(task.rhs)}`
    case 'advanced':
      return `${formatLinearLhs(task.a, task.b)} = ${formatLinearLhs(task.c, task.d)}`
    case 'master':
      return `${formatFactoredLhs(task.k, task.m, task.n)} = ${formatDisplayNumber(
        task.rhs
      )}`
  }
}

/** Levá a pravá strana pro zobrazení kolem prostředního „=“ na plátně. */
export function equationScaffoldSides(task: EquationTask): {
  left: string
  right: string
} {
  switch (task.level) {
    case 'basic':
      return {
        left: formatLinearLhs(task.a, task.b),
        right: formatDisplayNumber(task.rhs),
      }
    case 'advanced':
      return {
        left: formatLinearLhs(task.a, task.b),
        right: formatLinearLhs(task.c, task.d),
      }
    case 'master':
      return {
        left: formatFactoredLhs(task.k, task.m, task.n),
        right: formatDisplayNumber(task.rhs),
      }
  }
}

export function equationSolutionX(task: EquationTask): number {
  switch (task.level) {
    case 'basic':
      return (task.rhs - task.b) / task.a
    case 'advanced':
      return (task.d - task.b) / (task.a - task.c)
    case 'master':
      return (task.rhs - task.k * task.n) / (task.k * task.m)
  }
}

function generateBasic(): EquationTask {
  const id = newId()
  for (let i = 0; i < 240; i++) {
    const aMag = randomInt(1, MAX_ABS)
    const a = (Math.random() < 0.5 ? 1 : -1) * aMag
    const xSol = randomInt(-MAX_ABS, MAX_ABS)
    const b = randomInt(-MAX_ABS, MAX_ABS)
    const rhs = a * xSol + b
    if (rhs >= -MAX_ABS && rhs <= MAX_ABS) {
      return { level: 'basic', id, a, b, rhs }
    }
  }
  return { level: 'basic', id, a: 1, b: 0, rhs: 5 }
}

function generateAdvanced(): EquationTask {
  const id = newId()
  for (let i = 0; i < 320; i++) {
    const xSol = randomInt(-MAX_ABS, MAX_ABS)
    const a = randomInt(-MAX_ABS, MAX_ABS)
    const c = randomInt(-MAX_ABS, MAX_ABS)
    if (a === c) continue
    const b = randomInt(-MAX_ABS, MAX_ABS)
    const d = b + (a - c) * xSol
    if (d >= -MAX_ABS && d <= MAX_ABS) {
      return { level: 'advanced', id, a, b, c, d }
    }
  }
  return { level: 'advanced', id, a: 2, b: 1, c: 0, d: 3 }
}

function generateMaster(): EquationTask {
  const id = newId()
  for (let i = 0; i < 500; i++) {
    const kMag = randomInt(2, MAX_ABS)
    const k = (Math.random() < 0.5 ? 1 : -1) * kMag
    const mMag = randomInt(1, MAX_ABS)
    const m = (Math.random() < 0.5 ? 1 : -1) * mMag
    const n = randomInt(-MAX_ABS, MAX_ABS)
    const xSol = randomInt(-MAX_ABS, MAX_ABS)
    const rhs = k * (m * xSol + n)
    if (rhs >= -MAX_ABS && rhs <= MAX_ABS) {
      return { level: 'master', id, k, m, n, rhs }
    }
  }
  return { level: 'master', id, k: 2, m: 1, n: 0, rhs: 4 }
}

export function generateEquationTask(level: EquationLevel): EquationTask {
  switch (level) {
    case 'basic':
      return generateBasic()
    case 'advanced':
      return generateAdvanced()
    case 'master':
      return generateMaster()
  }
}
