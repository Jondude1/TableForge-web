import type { TableEntry } from './types'

/** Splits 1..sides into `count` contiguous ranges as evenly as possible (4 entries on a d10 -> 1-3, 4-6, 7-8, 9-10). */
export function ranges(sides: number, count: number): [number, number][] {
  if (count <= 0) return []
  const n = Math.min(count, sides)
  const base = Math.floor(sides / n)
  let extra = sides % n
  let start = 1
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const size = base + (extra-- > 0 ? 1 : 0)
    out.push([start, start + size - 1])
    start += size
  }
  return out
}

export function entriesFor(tableId: number, sides: number, texts: string[]): TableEntry[] {
  return ranges(sides, texts.length).map(([a, b], i) => ({ tableId, minRoll: a, maxRoll: b, text: texts[i] }))
}

export const roll = (sides: number) => 1 + Math.floor(Math.random() * sides)

export const lookup = (entries: Pick<TableEntry, "minRoll" | "maxRoll" | "text">[], n: number) => entries.find((e) => n >= e.minRoll && n <= e.maxRoll)

export function rangeLabel(a: number, b: number, sides: number) {
  const f = (v: number) => (sides === 100 && v === 100 ? '00' : String(v))
  return a === b ? f(a) : `${f(a)}–${f(b)}`
}

export const defaultCount = (sides: number) => (sides === 100 ? 20 : sides)
