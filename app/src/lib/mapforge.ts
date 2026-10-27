import { complete, parseObject, AiError } from './ai'
import type { AiSettings } from './settings'
import { aiReady } from './settings'
import type { Ctx } from './forge'
import type { MapFeature, Terrain, TileMap } from './types'
import { TERRAINS, terrainFromKey } from './types'

export interface GridRect { x: number; y: number; w: number; h: number }

export function colName(x: number): string {
  let n = x, s = ''
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}
export const cellName = (x: number, y: number) => `${colName(x)}${y + 1}`
export const rectLabel = (r: GridRect) =>
  r.w === 1 && r.h === 1 ? cellName(r.x, r.y) : `${cellName(r.x, r.y)}–${cellName(r.x + r.w - 1, r.y + r.h - 1)} (${r.w}×${r.h})`
export const spanning = (ax: number, ay: number, bx: number, by: number): GridRect =>
  ({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 })

export interface TerrainPaint { terrain: Terrain; cells: [number, number][] }
export type NewFeature = Omit<MapFeature, 'id' | 'mapId' | 'createdAt'>
export interface MapEdit { summary: string; features: NewFeature[]; terrain: TerrainPaint[]; removeUids: string[] }

const SYSTEM = `You are a map-building assistant for a Dungeons & Dragons Dungeon Master. You edit a square-grid map.
Coordinates: x is the column (0 = left edge), y is the row (0 = top edge). Squares are labeled with a column letter and a 1-based row number, so "C4" means x=2, y=3. Each square is a fixed number of feet.
You can do anything the DM asks by combining three operations:
1. "features": things placed on the map. Each occupies a w-by-h block of whole squares with its top-left at (x, y). Size things realistically for the square size unless the DM gives a size. "4 squares" means a 2x2 block. Large or irregular things (a ship, a wall, a camp) can be split into several features.
2. "terrain": repaint squares with one of these terrain types: ${TERRAINS.map((t) => t.key).join(', ')}. Use this for rivers, roads, forests, floors, walls, lava, swamps and so on. Give squares as "rects" [[x,y,w,h],...] and/or "cells" [[x,y],...].
3. "remove": ids of existing features to delete when the DM asks to remove or replace something.
Place things at or around the square(s) the DM selected unless they say otherwise. Keep everything inside the map bounds. Avoid covering existing features unless asked.
Each feature needs: name, kind (short noun), icon (a single emoji that best depicts it), color (a hex like #A0522D that suits it), x, y, w, h, and description.
The description is table-ready plain text with short labeled lines separated by \\n: "Read-aloud:" (1-2 vivid sentences), "Details:", and when it fits "Secret:" or "Encounter:".
Reply with JSON only: {"summary":"one short sentence of what you did","features":[...],"terrain":[{"terrain":"water","rects":[[x,y,w,h]],"cells":[[x,y]]}],"remove":[ids]}`

type ExistingFeature = MapFeature & { uid: string }

export async function build(s: AiSettings, ctx: Ctx | null, map: TileMap, features: ExistingFeature[], sel: GridRect, request: string): Promise<MapEdit> {
  if (!aiReady(s)) return offline(map, sel, request)
  const lines: string[] = []
  if (ctx) {
    lines.push(`Campaign: ${ctx.campaign.name}`)
    if (ctx.campaign.premise) lines.push(`Plot: ${ctx.campaign.premise.slice(0, 600)}`)
    if (ctx.campaign.setting) lines.push(`Setting: ${ctx.campaign.setting}`)
    if (ctx.campaign.tone) lines.push(`Tone: ${ctx.campaign.tone}`)
    lines.push('')
  }
  lines.push(`MAP "${map.name}": ${map.cols} columns (x 0-${map.cols - 1}, A-${colName(map.cols - 1)}) by ${map.rows} rows (y 0-${map.rows - 1}, 1-${map.rows}). Each square is ${map.feetPerSquare} ft.`)
  if (map.notes) lines.push(`Map notes: ${map.notes}`)
  lines.push('Terrain legend: ' + TERRAINS.map((t) => `${t.code}=${t.key}`).join(', '))
  lines.push('Current terrain, one line per row from y=0:')
  for (let y = 0; y < map.rows; y++) lines.push(map.terrain.slice(y * map.cols, (y + 1) * map.cols))
  // Short numeric ids for the model; mapped back to uids below.
  if (!features.length) lines.push('Existing features: none')
  else {
    lines.push('Existing features:')
    features.forEach((f, i) => lines.push(`- id ${i + 1}: ${f.name} (${f.kind}) at x=${f.x}, y=${f.y}, size ${f.w}x${f.h}`))
  }
  lines.push('')
  lines.push(`The DM selected ${sel.w === 1 && sel.h === 1 ? 'square' : 'the area'} ${rectLabel(sel)}: x=${sel.x}, y=${sel.y}, w=${sel.w}, h=${sel.h}.`)
  lines.push(`DM's request: ${request}`)
  const raw = await complete(s, SYSTEM, lines.join('\n'), 4000)
  return parse(raw, map, features)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const int = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d)

function parse(raw: string, map: TileMap, existing: ExistingFeature[]): MapEdit {
  const json = parseObject(raw)
  const feats: NewFeature[] = []
  for (const o of (Array.isArray(json.features) ? json.features : []) as Record<string, unknown>[]) {
    const w = clamp(int(o.w, 1), 1, map.cols), h = clamp(int(o.h, 1), 1, map.rows)
    const x = clamp(int(o.x, 0), 0, map.cols - w), y = clamp(int(o.y, 0), 0, map.rows - h)
    const name = String(o.name ?? '').trim() || String(o.kind ?? '').trim() || 'Feature'
    const icon = String(o.icon ?? '').trim()
    const color = String(o.color ?? '').trim()
    feats.push({
      x, y, w, h, name, kind: String(o.kind ?? '').trim(),
      icon: icon && icon.length <= 12 && !/[A-Za-z0-9]/.test(icon) ? icon : iconFor(name + ' ' + String(o.kind ?? '')),
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '',
      description: String(o.description ?? '').trim().replace(/\\n/g, '\n'),
    })
  }
  const paints: TerrainPaint[] = []
  for (const o of (Array.isArray(json.terrain) ? json.terrain : []) as Record<string, unknown>[]) {
    const t = terrainFromKey(String(o.terrain ?? ''))
    if (!t) continue
    const cells: [number, number][] = []
    for (const r of (Array.isArray(o.rects) ? o.rects : []) as number[][]) {
      const [rx, ry, rw = 1, rh = 1] = r.map((v) => int(v, 0))
      for (let yy = ry; yy < ry + rh; yy++) for (let xx = rx; xx < rx + rw; xx++) cells.push([xx, yy])
    }
    for (const c of (Array.isArray(o.cells) ? o.cells : []) as number[][]) cells.push([int(c[0], -1), int(c[1], -1)])
    const ok = cells.filter(([x, y]) => x >= 0 && x < map.cols && y >= 0 && y < map.rows)
    if (ok.length) paints.push({ terrain: t, cells: ok })
  }
  const removeUids = ((Array.isArray(json.remove) ? json.remove : []) as unknown[])
    .map((v) => existing[int(v, 0) - 1]?.uid).filter((u): u is string => !!u)
  if (!feats.length && !paints.length && !removeUids.length) {
    throw new AiError(String(json.summary ?? '') || 'Nothing to add for that request. Try describing it differently.')
  }
  return { summary: String(json.summary ?? '').trim(), features: feats, terrain: paints, removeUids }
}

export function paint(map: TileMap, paints: TerrainPaint[]): string {
  const chars = map.terrain.split('')
  for (const p of paints) for (const [x, y] of p.cells) chars[y * map.cols + x] = p.terrain.code
  return chars.join('')
}

export const blankTerrain = (cols: number, rows: number, base: Terrain) => base.code.repeat(cols * rows)

// ---------- Offline fallback ----------

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, nine: 9, ten: 10, twelve: 12, sixteen: 16 }

export function blockFor(n: number): [number, number] {
  let best: [number, number] = [n, 1]
  for (let a = 1; a <= Math.floor(Math.sqrt(n)); a++) if (n % a === 0) best = [n / a, a]
  return best
}

function offline(map: TileMap, sel: GridRect, request: string): MapEdit {
  let req = request.trim()
  for (const [k, v] of Object.entries(WORDS)) req = req.replace(new RegExp(`\\b${k}\\b(?=\\s*(squares|tiles|spaces|cells))`, 'gi'), String(v))
  const lower = req.toLowerCase()
  if (/^(make|turn|fill|paint|cover|change)\b/.test(lower)) {
    const t = TERRAINS.find((t) => lower.includes(t.key) || lower.includes(t.label.toLowerCase())) ?? lower.split(/\s+/).map(terrainFromKey).find(Boolean)
    if (t) {
      const cells: [number, number][] = []
      for (let y = sel.y; y < sel.y + sel.h; y++) for (let x = sel.x; x < sel.x + sel.w; x++) cells.push([x, y])
      return { summary: `Painted ${rectLabel(sel)} as ${t.label.toLowerCase()}.`, features: [], terrain: [{ terrain: t, cells }], removeUids: [] }
    }
  }
  let w = sel.w, h = sel.h
  const wxh = /(\d+)\s*(?:x|×|by)\s*(\d+)/i.exec(req)
  const nsq = /(\d+)\s*(squares|tiles|spaces|cells)/i.exec(req)
  if (wxh) { w = Number(wxh[1]); h = Number(wxh[2]) } else if (nsq) [w, h] = blockFor(Math.max(1, Number(nsq[1])))
  w = clamp(w, 1, map.cols); h = clamp(h, 1, map.rows)
  const x = clamp(sel.x, 0, map.cols - w), y = clamp(sel.y, 0, map.rows - h)
  let name = req
    .replace(/(\d+)\s*(?:x|×|by)\s*(\d+)/i, '').replace(/(\d+)\s*(squares|tiles|spaces|cells)/i, '')
    .replace(/\b(that|which)\s+(takes|take|is|covers|fills)\s+(up)?\s*/i, '')
    .replace(/^(add|place|put|build|draw|make|create)\s+/i, '').replace(/^(a|an|the|some)\s+/i, '')
    .replace(/\s+(here|there)$/i, '').replace(/^[\s,.]+|[\s,.]+$/g, '')
  name = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Feature'
  return {
    summary: `Placed ${name} at ${rectLabel({ x, y, w, h })}.`,
    features: [{ x, y, w, h, name, kind: name.toLowerCase(), icon: iconFor(lower), color: '', description: `Details: ${request}` }],
    terrain: [], removeUids: [],
  }
}

const ICONS: [string, string][] = [
  ['lighthouse', '🗼'], ['tower', '🗼'], ['castle', '🏰'], ['keep', '🏰'], ['fort', '🏰'], ['temple', '⛪'], ['shrine', '⛩️'], ['church', '⛪'],
  ['chapel', '⛪'], ['tavern', '🍺'], ['inn', '🍺'], ['shop', '🛒'], ['market', '🛒'], ['stall', '🛒'], ['smith', '⚒️'], ['forge', '⚒️'],
  ['ship', '⛵'], ['boat', '⛵'], ['dock', '⚓'], ['pier', '⚓'], ['bridge', '🌉'], ['tree', '🌲'], ['grove', '🌲'], ['forest', '🌲'],
  ['rock', '🪨'], ['boulder', '🪨'], ['mountain', '⛰️'], ['pond', '💧'], ['lake', '💧'], ['fountain', '⛲'], ['camp', '⛺'], ['tent', '⛺'],
  ['fire', '🔥'], ['cave', '🕳️'], ['ruin', '🏚️'], ['dragon', '🐉'], ['goblin', '👺'], ['orc', '👹'], ['lair', '🐉'], ['spider', '🕷️'],
  ['grave', '🪦'], ['crypt', '💀'], ['skull', '💀'], ['chest', '💰'], ['treasure', '💰'], ['door', '🚪'], ['gate', '🚪'], ['stair', '🪜'],
  ['ladder', '🪜'], ['statue', '🗿'], ['well', '🪣'], ['trap', '⚠️'], ['flag', '🚩'], ['altar', '🕯️'], ['library', '📚'], ['house', '🏠'],
  ['hut', '🛖'], ['cottage', '🏡'], ['shack', '🛖'], ['farm', '🌾'], ['barn', '🌾'], ['mill', '🌬️'], ['wizard', '🧙'], ['guard', '🛡️'],
]
export const iconFor = (text: string) => ICONS.find(([k]) => text.toLowerCase().includes(k))?.[1] ?? '🏠'
