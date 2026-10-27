import { AiError, complete, parseObject, type ImagePart } from './ai'
import type { AiSettings } from './settings'
import { aiReady } from './settings'
import { blankStatBlock, type NamedText, type StatBlock } from './types'

const SHAPE = `Reply with JSON only, exactly this shape (use "" or [] when something isn't on the stat block):
{"name":"","meta":"size type, alignment","ac":"","hp":"","speed":"","str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10,
"saves":"","skills":"","vulnerabilities":"","resistances":"","immunities":"","conditionImmunities":"","senses":"","languages":"","cr":"",
"traits":[{"name":"","text":""}],"actions":[{"name":"","text":""}],"bonusActions":[],"reactions":[],"legendaryIntro":"","legendary":[],"notes":""}
Rules: "immunities" is damage immunities. Ability scores are numbers (scores, not modifiers). Keep each action's text exactly as written,
including attack bonuses ("+7 to hit") and damage dice ("2d6 + 4"). "cr" includes XP if shown, e.g. "5 (1,800 XP)".
"meta" is the line under the name, e.g. "Medium humanoid (goblinoid), neutral evil". Put anything that doesn't fit (lair actions, flavor) in "notes".`

const READ_SYSTEM = `You transcribe Dungeons & Dragons 5e monster stat blocks into structured data for a Dungeon Master's app.
Read carefully: photos may be angled, glared, or split across columns or pages. Fix obvious OCR-style errors, but never invent numbers that aren't there.
If several images are given they are parts of the same stat block, in order. ${SHAPE}`

const MAKE_SYSTEM = `You design balanced, flavorful Dungeons & Dragons 5e monsters following the official stat block conventions and CR guidelines
(Dungeon Master's Guide monster creation tables). ${SHAPE}`

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const num = (v: unknown, d = 10) => { const n = Number(String(v).replace(/[^\d-]/g, '')); return Number.isFinite(n) && n > 0 && n <= 40 ? n : d }
const list = (v: unknown): NamedText[] => (Array.isArray(v) ? v : [])
  .map((x) => (typeof x === 'string' ? splitNamed(x) : { name: str((x as NamedText).name).replace(/\.$/, ''), text: str((x as NamedText).text) }))
  .filter((x) => x.name || x.text)

/** "Bite. Melee Weapon Attack: ..." -> { name: "Bite", text: "Melee Weapon Attack: ..." } */
export function splitNamed(s: string): NamedText {
  const m = /^\s*([^.]{1,60}?(?:\s*\([^)]*\))?)\.\s+([\s\S]*)$/.exec(s.trim())
  return m ? { name: m[1].trim(), text: m[2].trim() } : { name: '', text: s.trim() }
}

export function normalize(o: Record<string, unknown>): StatBlock {
  const b = blankStatBlock()
  return {
    ...b,
    name: str(o.name) || 'Unnamed creature', meta: str(o.meta), ac: str(o.ac), hp: str(o.hp), speed: str(o.speed) || b.speed,
    str: num(o.str), dex: num(o.dex), con: num(o.con), int: num(o.int), wis: num(o.wis), cha: num(o.cha),
    saves: str(o.saves), skills: str(o.skills), vulnerabilities: str(o.vulnerabilities), resistances: str(o.resistances),
    immunities: str(o.immunities), conditionImmunities: str(o.conditionImmunities), senses: str(o.senses), languages: str(o.languages),
    cr: str(o.cr), traits: list(o.traits), actions: list(o.actions), bonusActions: list(o.bonusActions), reactions: list(o.reactions),
    legendaryIntro: str(o.legendaryIntro), legendary: list(o.legendary), notes: str(o.notes),
  }
}

function needAi(s: AiSettings) {
  if (!aiReady(s)) throw new AiError('Reading stat blocks needs Claude. Add your Claude API key in Settings, or use "Start blank" and type it in.')
}

/** Reads one or more photos of a stat block. */
export async function fromPhotos(s: AiSettings, images: ImagePart[]): Promise<StatBlock> {
  needAi(s)
  const raw = await complete(s, READ_SYSTEM, 'Transcribe this stat block.', 4000, images)
  return normalize(parseObject(raw))
}

/** Reads a stat block pasted as text (from a PDF, D&D Beyond, a website...). */
export async function fromText(s: AiSettings, text: string): Promise<StatBlock> {
  needAi(s)
  const raw = await complete(s, READ_SYSTEM, `Transcribe this stat block:\n\n${text}`, 4000)
  return normalize(parseObject(raw))
}

/** Designs a new monster from a description, fitted to the campaign. */
export async function generate(s: AiSettings, idea: string, campaign: string): Promise<StatBlock> {
  needAi(s)
  const raw = await complete(s, MAKE_SYSTEM, `${campaign ? campaign + '\n\n' : ''}Create this monster: ${idea}`, 4000)
  return normalize(parseObject(raw))
}

/** Shrinks a photo so it uploads fast and fits Claude's limits (longest side 1568 px, JPEG). */
export async function prepareImage(file: File): Promise<ImagePart> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new AiError("Couldn't open that image.")); i.src = url })
    const scale = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const data = c.toDataURL('image/jpeg', 0.85).split(',')[1]
    return { mediaType: 'image/jpeg', data }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---------- Dice in stat block text ----------

export type Seg = { t: 'text'; s: string } | { t: 'hit'; s: string; bonus: number } | { t: 'dmg'; s: string; n: number; d: number; plus: number }

/** Finds "+7 to hit" and "2d6 + 4" in action text so they can be tapped to roll. */
export function rollable(text: string): Seg[] {
  const re = /([+-]\d+)\s+to hit|(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/g
  const out: Seg[] = []
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) })
    if (m[1]) out.push({ t: 'hit', s: m[0], bonus: Number(m[1]) })
    else out.push({ t: 'dmg', s: m[0], n: Number(m[2]), d: Number(m[3]), plus: m[4] ? (m[4] === '-' ? -1 : 1) * Number(m[5]) : 0 })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) })
  return out
}

export function rollDice(n: number, d: number, plus = 0) {
  const rolls = Array.from({ length: Math.min(n, 100) }, () => 1 + Math.floor(Math.random() * d))
  return { total: rolls.reduce((a, b) => a + b, 0) + plus, rolls }
}
