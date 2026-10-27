import { complete, parseObject, AiError } from './ai'
import type { AiSettings } from './settings'
import { aiReady } from './settings'
import type { Campaign, Idea, IdeaType, Player, PlotBeat } from './types'
import { BEAT_STATUS, IDEA_TYPES, asType } from './types'
import * as W from './wordtables'

/** A generated suggestion before the DM saves it. */
export interface Card { key: string; title: string; body: string; tags: string }
let counter = 0
export const mkCard = (title: string, body: string, tags = ''): Card => ({ key: `c${Date.now()}-${counter++}`, title, body, tags })

export interface Ctx { campaign: Campaign; beats: PlotBeat[]; ideas: Idea[]; players: Player[] }

export function describe(ctx: Ctx): string {
  const c = ctx.campaign
  const lines = [`CAMPAIGN: ${c.name}`]
  if (c.premise) lines.push(`Premise / overall plot: ${c.premise}`)
  if (c.setting) lines.push(`Setting: ${c.setting}`)
  if (c.tone) lines.push(`Tone: ${c.tone}`)
  if (ctx.players.length) lines.push('Party: ' + ctx.players.map((p) => [p.characterName, p.characterClass].filter(Boolean).join(', ')).join('; '))
  if (ctx.beats.length) {
    lines.push('Plot outline so far (in order):')
    ctx.beats.forEach((b, i) => {
      const status = BEAT_STATUS[b.status as keyof typeof BEAT_STATUS] ?? 'Planned'
      lines.push(`${i + 1}. ${b.act ? `[${b.act}] ` : ''}${b.title} (${status})${b.summary ? ' — ' + b.summary.slice(0, 240) : ''}`)
    })
  }
  const named = ctx.ideas.filter((i) => i.type === 'NPC' || i.type === 'LOCATION')
  if (named.length) lines.push('Established NPCs and locations: ' + named.slice(0, 40).map((i) => i.title).join(', '))
  const own = ctx.ideas.filter((i) => i.isOwn).slice(0, 15)
  if (own.length) {
    lines.push("The DM's own ideas to weave in where it fits:")
    own.forEach((i) => lines.push(`- ${i.title}: ${i.body.slice(0, 160)}`))
  }
  return lines.join('\n')
}

const SYSTEM = `You are a creative assistant for a Dungeons & Dragons 5e Dungeon Master preparing sessions.
Give vivid, specific, table-ready ideas a DM can use immediately. Avoid generic fantasy clichés unless asked.
Keep each idea consistent with the campaign details provided. Don't reuse names already established, unless the DM names a specific character or place, in which case use exactly that name.
Always reply with JSON only, in exactly this shape: {"items":[{"title":"...","body":"...","tags":"..."}]}
"body" is plain text using short labeled lines separated by \\n. "tags" is 1-4 comma-separated keywords.`

const SHAPE: Record<IdeaType, string> = {
  NPC: "title = the NPC's name. body lines: Role, Look, Personality, Wants, Secret, Voice/mannerism, Hook (how the party meets them).",
  EVENT: 'title = a short event name. body lines: Trigger, What happens, Stakes, Complication, Possible outcomes.',
  LOCATION: "title = the place name. body lines: Type, First impression (read-aloud, 2 sentences), Notable features, Who's here, Secret, Hooks.",
  DUNGEON_ROOM: 'title = a room name. body lines: Read-aloud (2-3 sentences), Contents, Threat or trap (with a DC if relevant), Treasure, Exits, Twist.',
  MAGIC_ITEM: 'title = the item name. body lines: Rarity, Attunement (yes/no and by whom), Appearance, Properties (5e mechanics), Quirk, History.',
  STORY_BEAT: 'title = a short beat name. body lines: What happens, Why it matters, Connects to (existing beats/NPCs), Foreshadowing, Player choice.',
  NOTE: 'title = a short name. body = a few useful lines.',
}

function toCards(raw: string): Card[] {
  const obj = parseObject(raw)
  const items = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  const cards = items
    .map((o) => {
      const title = String(o.title ?? '').trim()
      const body = String(o.body ?? '').trim().replace(/\\n/g, '\n')
      return title || body ? mkCard(title || body.slice(0, 40), body, String(o.tags ?? '').trim()) : null
    })
    .filter((c): c is Card => c != null)
  if (!cards.length) throw new AiError("The model didn't return any ideas. Try again.")
  return cards
}

export async function generate(s: AiSettings, ctx: Ctx, type: IdeaType, count: number, steer: string, avoid: string[]): Promise<Card[]> {
  if (!aiReady(s)) return offlineCards(type, count)
  const user = [
    describe(ctx), '',
    `Generate ${count} distinct ${IDEA_TYPES[type].singular} ideas for this campaign.`,
    SHAPE[type],
    steer && `The DM wants: ${steer}`,
    avoid.length ? `Do not repeat or closely resemble these: ${avoid.join('; ')}` : '',
  ].filter(Boolean).join('\n')
  return toCards(await complete(s, SYSTEM, user))
}

const FLESH_SYSTEM = `You help a Dungeons & Dragons 5e Dungeon Master flesh out an idea they have already started.
The DM's details are canon: keep every name exactly as written (spelling included), keep every fact they gave, and never contradict them.
Fill in everything they left open so the result is vivid, specific and table-ready, and consistent with the campaign.
Weave the DM's details into the labeled lines where they belong rather than repeating them in a list.
When asked for several versions, keep the DM's details identical in each and vary only what they left open.
Always reply with JSON only, in exactly this shape: {"items":[{"title":"...","body":"...","tags":"..."}]}
"body" is plain text using short labeled lines separated by \\n. "tags" is 1-4 comma-separated keywords.`

/** Expands an idea the DM already has (a name, a few facts) without changing what they gave. */
export async function fleshOut(s: AiSettings, ctx: Ctx, type: IdeaType, name: string, notes: string, versions: number, avoid: string[] = []): Promise<Card[]> {
  if (!aiReady(s)) return offlineFleshOut(type, name, notes, versions)
  const user = [
    describe(ctx), '',
    `Flesh out this ${IDEA_TYPES[type].singular}${versions > 1 ? `, as ${versions} different versions` : ''}.`,
    name.trim() ? `Name (use exactly as the title): ${name.trim()}` : 'Name: not decided — invent a fitting one.',
    notes.trim() ? `What the DM already knows:\n${notes.trim()}` : 'The DM has no other details yet.',
    SHAPE[type],
    avoid.length ? `Make it clearly different from these earlier versions: ${avoid.join('; ')}` : '',
  ].filter(Boolean).join('\n')
  const cards = await toCards(await complete(s, FLESH_SYSTEM, user)).slice(0, versions)
  // The DM's name is canon even if the model drifts.
  return name.trim() ? cards.map((c) => ({ ...c, title: name.trim() })) : cards
}

function offlineFleshOut(type: IdeaType, name: string, notes: string, versions: number): Card[] {
  return offlineCards(type, versions).map((c) => mkCard(
    name.trim() || c.title,
    [...notes.trim().split('\n').filter(Boolean).map((l) => (l.includes(':') ? l.trim() : `Notes: ${l.trim()}`)), c.body].join('\n'),
    c.tags,
  ))
}

export async function nextBeats(s: AiSettings, ctx: Ctx, steer: string): Promise<Card[]> {
  if (!aiReady(s)) return offlineCards('STORY_BEAT', 4)
  const user = [
    describe(ctx), '',
    'Recommend 4 possible next story beats for the coming sessions. Build on beats marked In play or Done, pay off foreshadowing, and move toward the overall plot.',
    SHAPE.STORY_BEAT, steer && `The DM wants: ${steer}`,
  ].filter(Boolean).join('\n')
  return toCards(await complete(s, SYSTEM, user))
}

export async function fillGap(s: AiSettings, ctx: Ctx, before: PlotBeat | null, after: PlotBeat | null, steer: string): Promise<Card[]> {
  if (!aiReady(s)) return offlineCards('STORY_BEAT', 3)
  const ask =
    before && after ? `There is a gap between "${before.title}" and "${after.title}". Propose 3 alternative bridging beats that get the story logically from one to the other.`
      : !before && after ? `Propose 3 alternative opening beats that lead into "${after.title}".`
        : before ? `Propose 3 alternative beats that follow "${before.title}" and push toward the campaign's climax.`
          : 'Propose 3 alternative opening beats for this campaign.'
  const user = [describe(ctx), '', ask, 'Each option should be a different direction, not variations of one idea.', SHAPE.STORY_BEAT, steer && `The DM wants: ${steer}`]
    .filter(Boolean).join('\n')
  return toCards(await complete(s, SYSTEM, user))
}

export async function tableEntries(s: AiSettings, ctx: Ctx | null, name: string, description: string, count: number): Promise<string[]> {
  if (!aiReady(s)) return offlineTable(name, count)
  const user = [
    ctx ? describe(ctx) + '\n' : '',
    `Write ${count} entries for a random table called "${name}".`,
    description && `What the table is for: ${description}`,
    'Each entry is one or two punchy sentences a DM can read aloud or use immediately. All entries must be different.',
    'Put each entry\'s text in "body"; "title" can be a 1-3 word label.',
  ].filter(Boolean).join('\n')
  const cards = toCards(await complete(s, SYSTEM, user, 4000))
  return cards.map((c) => c.body || c.title).slice(0, count)
}

// ---------- Offline generation ----------

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const shuffle = <T,>(a: T[]): T[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }

function offlineOne(type: IdeaType): Card {
  switch (type) {
    case 'NPC':
      return mkCard(`${pick(W.firstNames)} ${pick(W.surnames)}`, [
        `Role: ${pick(W.ancestries)} ${pick(W.roles)}`, `Look: ${pick(W.looks)}`, `Personality: ${pick(W.personalities)}`,
        `Wants: ${pick(W.wants)}`, `Secret: ${pick(W.secrets)}`, `Voice: ${pick(W.voices)}`,
      ].join('\n'), 'npc')
    case 'EVENT':
      return mkCard(pick(W.eventNames), [`Trigger: ${pick(W.triggers)}`, `What happens: ${pick(W.happenings)}`, `Stakes: ${pick(W.stakes)}`, `Complication: ${pick(W.complications)}`].join('\n'), 'event')
    case 'LOCATION':
      return mkCard(`The ${pick(W.placeAdjs)} ${pick(W.placeNouns)}`, [
        `Type: ${pick(W.placeTypes)}`, `First impression: ${pick(W.impressions)}`, `Notable feature: ${pick(W.features)}`,
        `Who's here: ${pick(W.firstNames)}, a ${pick(W.roles)} who ${pick(W.secrets)}`,
      ].join('\n'), 'location')
    case 'DUNGEON_ROOM':
      return mkCard(pick(W.roomNames), [
        `Read-aloud: ${pick(W.readAlouds)}`, `Threat: ${pick(W.threats)}`, `Treasure: ${pick(W.treasures)}`,
        `Exits: ${1 + Math.floor(Math.random() * 3)} (${shuffle(['north', 'east', 'south', 'west']).slice(0, 2).join(', ')})`, `Twist: ${pick(W.twists)}`,
      ].join('\n'), 'dungeon')
    case 'MAGIC_ITEM':
      return mkCard(`${pick(W.itemAdjs)} ${pick(W.itemNouns)}`, [
        `Rarity: ${pick(['Uncommon', 'Uncommon', 'Rare', 'Rare', 'Very rare'])}`, `Attunement: ${Math.random() < 0.5 ? 'yes' : 'no'}`,
        `Properties: ${pick(W.itemProps)}`, `Quirk: ${pick(W.quirks)}`,
      ].join('\n'), 'magic item')
    case 'STORY_BEAT':
      return mkCard(pick(W.beatNames), [`What happens: ${pick(W.happenings)}`, `Why it matters: it puts ${pick(W.stakes)} at risk`, `Complication: ${pick(W.complications)}`].join('\n'), 'story')
    default:
      return mkCard('Idea', pick(W.happenings))
  }
}

export const offlineCards = (type: IdeaType, count: number) => Array.from({ length: count }, () => offlineOne(asType(type)))

function offlineTable(name: string, count: number): string[] {
  const n = name.toLowerCase()
  const pool =
    n.includes('npc') || n.includes('name') ? Array.from({ length: count }, () => `${pick(W.firstNames)} ${pick(W.surnames)}, ${pick(W.ancestries)} ${pick(W.roles)}`)
      : n.includes('loot') || n.includes('treasure') || n.includes('item') ? [...W.treasures, ...W.itemProps.map((p) => `${pick(W.itemAdjs)} ${pick(W.itemNouns)}: ${p}`)]
        : n.includes('event') || n.includes('encounter') ? [...W.happenings, ...W.threats]
          : n.includes('rumor') || n.includes('rumour') ? W.secrets.map((s) => `They say ${pick(W.firstNames)} ${s}.`)
            : n.includes('room') || n.includes('dungeon') ? [...W.readAlouds, ...W.twists]
              : [...W.happenings, ...W.features, ...W.complications]
  const sh = shuffle(pool)
  return Array.from({ length: count }, (_, i) => sh[i] ?? pick(pool))
}
