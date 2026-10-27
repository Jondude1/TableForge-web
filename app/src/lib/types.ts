// Same data model as the Android app, so campaigns can move between them.

export interface Campaign { id?: number; name: string; premise: string; tone: string; setting: string; createdAt: number }

export type IdeaType = 'NPC' | 'EVENT' | 'LOCATION' | 'DUNGEON_ROOM' | 'MAGIC_ITEM' | 'STORY_BEAT' | 'NOTE'

export const IDEA_TYPES: Record<IdeaType, { label: string; singular: string; color: string }> = {
  NPC: { label: 'NPCs', singular: 'NPC', color: '#D4A84B' },
  EVENT: { label: 'Events', singular: 'event', color: '#E0805F' },
  LOCATION: { label: 'Locations', singular: 'location', color: '#8DAE74' },
  DUNGEON_ROOM: { label: 'Dungeon rooms', singular: 'dungeon room', color: '#A493D1' },
  MAGIC_ITEM: { label: 'Magic items', singular: 'magic item', color: '#63B7CC' },
  STORY_BEAT: { label: 'Story beats', singular: 'story beat', color: '#D884AA' },
  NOTE: { label: 'Notes', singular: 'note', color: '#B9AB92' },
}
export const ALL_TYPES = Object.keys(IDEA_TYPES) as IdeaType[]
export const GENERATABLE: IdeaType[] = ['NPC', 'EVENT', 'LOCATION', 'DUNGEON_ROOM', 'MAGIC_ITEM', 'STORY_BEAT']
export const asType = (t: string): IdeaType => (t in IDEA_TYPES ? (t as IdeaType) : 'NOTE')
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface Idea {
  id?: number; campaignId: number; type: string; title: string; body: string; tags: string
  isOwn: boolean; favorite: boolean; used: boolean; createdAt: number
}

export type BeatStatus = 'PLANNED' | 'IN_PLAY' | 'DONE'
export const BEAT_STATUS: Record<BeatStatus, string> = { PLANNED: 'Planned', IN_PLAY: 'In play', DONE: 'Done' }

export interface PlotBeat { id?: number; campaignId: number; position: number; act: string; title: string; summary: string; status: string }

export interface Player { id?: number; campaignId: number; playerName: string; characterName: string; characterClass: string }

export interface PartyItem {
  id?: number; campaignId: number; holderId: number | null; name: string; rarity: string
  requiresAttunement: boolean; attuned: boolean; charges: string; notes: string; acquiredAt: string
}
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Very rare', 'Legendary', 'Artifact']
export const rarityColor = (r: string) =>
  ({ common: '#C9BEA8', uncommon: '#7FC27A', rare: '#6AA8E6', 'very rare': '#B487E6', legendary: '#E8A64A', artifact: '#E86E5E' } as Record<string, string>)[
    r.toLowerCase()
  ] ?? '#C9BEA8'

export interface RollTable { id?: number; campaignId: number | null; name: string; dieSides: number; description: string; createdAt: number }
export interface TableEntry { id?: number; tableId: number; minRoll: number; maxRoll: number; text: string }
export const DICE = [4, 6, 8, 10, 12, 20, 100]

export interface MapNode { id?: number; campaignId: number; label: string; note: string; kind: string; x: number; y: number; ideaId: number | null }
export interface MapEdge { id?: number; campaignId: number; fromId: number; toId: number; label: string }

export interface TileMap {
  id?: number; campaignId: number; name: string; cols: number; rows: number; terrain: string
  feetPerSquare: number; notes: string; createdAt: number
}
export interface MapFeature {
  id?: number; mapId: number; x: number; y: number; w: number; h: number; name: string
  kind: string; icon: string; color: string; description: string; createdAt: number
}

export interface Terrain { code: string; key: string; label: string; color: string }
export const TERRAINS: Terrain[] = [
  { code: 'g', key: 'grass', label: 'Grass', color: '#3E5230' },
  { code: 'f', key: 'forest', label: 'Forest', color: '#27391F' },
  { code: 'd', key: 'dirt', label: 'Dirt / road', color: '#6B5236' },
  { code: 's', key: 'sand', label: 'Sand', color: '#B49A64' },
  { code: 'w', key: 'water', label: 'Shallow water', color: '#35617A' },
  { code: 'D', key: 'deep', label: 'Deep water', color: '#1E3B52' },
  { code: 'm', key: 'swamp', label: 'Swamp', color: '#3D4A2E' },
  { code: 'r', key: 'stone', label: 'Stone floor', color: '#5A554E' },
  { code: 'c', key: 'cobble', label: 'Cobblestone', color: '#6E655A' },
  { code: 'o', key: 'wood', label: 'Wood floor', color: '#7A5634' },
  { code: '#', key: 'wall', label: 'Wall', color: '#26221E' },
  { code: '^', key: 'mountain', label: 'Mountain / rock', color: '#6F6A64' },
  { code: 'n', key: 'snow', label: 'Snow / ice', color: '#C9D3D8' },
  { code: 'l', key: 'lava', label: 'Lava', color: '#B5432A' },
  { code: 'v', key: 'void', label: 'Pit / void', color: '#0B0907' },
]
export const terrainByCode = (c: string) => TERRAINS.find((t) => t.code === c) ?? TERRAINS[0]
export function terrainFromKey(k: string): Terrain | undefined {
  const s = k.trim().toLowerCase().replace(/ /g, '_')
  const direct = TERRAINS.find((t) => t.key === s || t.label.toLowerCase() === k.trim().toLowerCase())
  if (direct) return direct
  const by = (key: string) => TERRAINS.find((t) => t.key === key)
  if (s.includes('tree') || s === 'wood') return by('forest')
  if (s.includes('road') || s.includes('path')) return by('dirt')
  if (s.includes('river') || s.includes('pond') || s.includes('lake')) return by('water')
  if (s.includes('ocean') || s.includes('sea')) return by('deep')
  if (s.includes('rock') || s.includes('cliff') || s.includes('hill')) return by('mountain')
  if (s.includes('floor')) return by('stone')
  if (s.includes('ice')) return by('snow')
  return undefined
}

// ---------- Monsters ----------

export interface NamedText { name: string; text: string }

/** A 5e-style stat block. Text fields are kept as written so nothing is lost when scanning. */
export interface StatBlock {
  name: string
  meta: string            // "Large dragon, chaotic evil"
  ac: string              // "17 (natural armor)"
  hp: string              // "178 (17d12 + 68)"
  speed: string
  str: number; dex: number; con: number; int: number; wis: number; cha: number
  saves: string
  skills: string
  vulnerabilities: string
  resistances: string
  immunities: string
  conditionImmunities: string
  senses: string
  languages: string
  cr: string              // "13 (10,000 XP)"
  traits: NamedText[]
  actions: NamedText[]
  bonusActions: NamedText[]
  reactions: NamedText[]
  legendaryIntro: string
  legendary: NamedText[]
  notes: string
}

export interface Monster {
  id?: number; campaignId: number; name: string; cr: string; data: StatBlock
  hpNow: number | null; createdAt: number
}

export const blankStatBlock = (name = ''): StatBlock => ({
  name, meta: '', ac: '', hp: '', speed: '30 ft.', str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
  saves: '', skills: '', vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '',
  senses: '', languages: '', cr: '', traits: [], actions: [], bonusActions: [], reactions: [], legendaryIntro: '', legendary: [], notes: '',
})

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export const mod = (score: number) => Math.floor((score - 10) / 2)
export const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/** Max hit points from "178 (17d12 + 68)" -> 178. */
export const maxHp = (hp: string) => { const m = /^\s*(\d+)/.exec(hp); return m ? Number(m[1]) : null }
