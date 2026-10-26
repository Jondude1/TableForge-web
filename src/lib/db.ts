import Dexie, { type Table } from 'dexie'
import { entriesFor } from './tablemath'
import type { Campaign, Idea, MapEdge, MapFeature, MapNode, PartyItem, Player, PlotBeat, RollTable, TableEntry, TileMap } from './types'

/**
 * Every synced record carries a permanent `uid` and an `updatedAt` time. Deletes leave a
 * tombstone so they propagate to the other device. See sync.ts.
 */
export interface Synced { uid: string; updatedAt: number }
export interface Tombstone { uid: string; campaignUid: string; deletedAt: number }

export type CampaignRow = Campaign & Synced & { syncCode?: string }
export type IdeaRow = Idea & Synced
export type BeatRow = PlotBeat & Synced
export type PlayerRow = Player & Synced
export type ItemRow = PartyItem & Synced
export type TableRow = RollTable & Synced
export type NodeRow = MapNode & Synced
export type EdgeRow = MapEdge & Synced
export type TileMapRow = TileMap & Synced
export type FeatureRow = MapFeature & Synced

class TFDB extends Dexie {
  campaigns!: Table<CampaignRow, number>
  ideas!: Table<IdeaRow, number>
  beats!: Table<BeatRow, number>
  players!: Table<PlayerRow, number>
  items!: Table<ItemRow, number>
  rollTables!: Table<TableRow, number>
  entries!: Table<TableEntry, number>
  nodes!: Table<NodeRow, number>
  edges!: Table<EdgeRow, number>
  tileMaps!: Table<TileMapRow, number>
  features!: Table<FeatureRow, number>
  tombstones!: Table<Tombstone, string>

  constructor() {
    super('tableforge')
    this.version(1).stores({
      campaigns: '++id, &uid, createdAt',
      ideas: '++id, &uid, campaignId',
      beats: '++id, &uid, campaignId, position',
      players: '++id, &uid, campaignId',
      items: '++id, &uid, campaignId, holderId',
      rollTables: '++id, &uid, campaignId',
      entries: '++id, tableId',
      nodes: '++id, &uid, campaignId',
      edges: '++id, &uid, campaignId, fromId, toId',
      tileMaps: '++id, &uid, campaignId',
      features: '++id, &uid, mapId',
      tombstones: '&uid, campaignUid',
    })
  }
}

export const db = new TFDB()

export const newUid = (): string =>
  (globalThis.crypto && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)

export const now = () => Date.now()

/** Fires after every local write so sync can push soon. */
type Listener = () => void
const listeners = new Set<Listener>()
export const onLocalChange = (l: Listener) => { listeners.add(l); return () => listeners.delete(l) }
export const touched = () => listeners.forEach((l) => l())

async function campaignUidOf(campaignId: number | null | undefined): Promise<string> {
  if (campaignId == null) return ''
  return (await db.campaigns.get(campaignId))?.uid ?? ''
}

/** Records a deletion so the other device removes the same record. */
export async function tombstone(uid: string | undefined, campaignId: number | null | undefined) {
  if (!uid) return
  await db.tombstones.put({ uid, campaignUid: await campaignUidOf(campaignId), deletedAt: now() })
}

// ---------- Write helpers: stamp updatedAt, leave tombstones, notify sync ----------

type Row = { id?: number; uid?: string; updatedAt?: number }

export async function save<T extends Row>(table: Table<T, number>, row: T): Promise<number> {
  const r = { ...row, uid: row.uid || newUid(), updatedAt: now() } as T
  const id = (await table.put(r)) as number
  touched()
  return id
}

export async function remove<T extends Row & { campaignId?: number | null }>(table: Table<T, number>, row: T, campaignId?: number | null) {
  if (row.id == null) return
  await db.transaction('rw', [table, db.tombstones, db.campaigns], async () => {
    await tombstone(row.uid, campaignId ?? row.campaignId)
    await table.delete(row.id!)
  })
  touched()
}

let ensuring: Promise<number> | null = null
export function ensureCampaign(): Promise<number> {
  ensuring ??= createFirstCampaign().finally(() => { ensuring = null })
  return ensuring
}

async function createFirstCampaign(): Promise<number> {
  const first = await db.campaigns.orderBy('createdAt').first()
  if (first?.id) return first.id
  const id = await db.campaigns.add({
    name: 'My Campaign', premise: '', tone: 'Heroic fantasy with moments of humor', setting: '',
    createdAt: now(), uid: newUid(), updatedAt: now(),
  })
  await seedTables()
  return id
}

async function seedTables() {
  const mk = async (name: string, dieSides: number, description: string, texts: string[]) => {
    const id = await db.rollTables.add({ name, dieSides, description, campaignId: null, createdAt: now(), uid: newUid(), updatedAt: now() })
    await db.entries.bulkAdd(entriesFor(id, dieSides, texts))
  }
  await mk('Tavern Rumors', 6, 'Gossip overheard over a pint', [
    "The miller's daughter has been seen walking into the lake at night.",
    'A dragon was spotted over the northern peaks, carrying a cart.',
    "The new priest doesn't cast a shadow.",
    'Someone is paying gold for rat tails. Lots of gold.',
    'The old mine reopened, but nobody hired any miners.',
    "The baron's heir is missing, and the baron hasn't told anyone.",
  ])
  await mk('Weather', 8, "Today's weather on the road", [
    'Clear and bright', 'Light drizzle', 'Thick fog until noon', 'Strong winds',
    'Heavy rain — travel speed halved', 'Thunderstorm', 'Unseasonable heat', 'Eerie stillness, no birdsong',
  ])
}

/** Deletes a campaign and everything that belongs to it. */
export async function deleteCampaignCascade(c: CampaignRow) {
  const id = c.id!
  await db.transaction('rw', [db.campaigns, db.ideas, db.beats, db.players, db.items, db.rollTables, db.entries, db.nodes, db.edges, db.tileMaps, db.features, db.tombstones], async () => {
    const maps = await db.tileMaps.where('campaignId').equals(id).toArray()
    for (const m of maps) await db.features.where('mapId').equals(m.id!).delete()
    const tables = await db.rollTables.where('campaignId').equals(id).toArray()
    for (const t of tables) await db.entries.where('tableId').equals(t.id!).delete()
    await Promise.all([
      db.ideas.where('campaignId').equals(id).delete(), db.beats.where('campaignId').equals(id).delete(),
      db.players.where('campaignId').equals(id).delete(), db.items.where('campaignId').equals(id).delete(),
      db.rollTables.where('campaignId').equals(id).delete(), db.nodes.where('campaignId').equals(id).delete(),
      db.edges.where('campaignId').equals(id).delete(), db.tileMaps.where('campaignId').equals(id).delete(),
      db.tombstones.where('campaignUid').equals(c.uid).delete(),
    ])
    await db.campaigns.delete(id)
  })
}
