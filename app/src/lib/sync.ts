/**
 * Device-to-device sync through public Nostr relays. No accounts, no servers of our own.
 *
 * - A campaign is linked by a random sync code. From the code we derive a signing key
 *   (so only code holders can write) and an AES key (so only code holders can read).
 * - Every record is its own encrypted, replaceable event (NIP-78, kind 30078) keyed by the
 *   record's uid. Relays keep the latest version of each record.
 * - Merging is per record, last write wins by `updatedAt`. Deletes are tombstones.
 * - Each change is sent to several relays at once; every device always keeps a full local copy.
 */
import { finalizeEvent, getPublicKey, verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure'
import { db, now, type CampaignRow, type Synced, type Tombstone } from './db'
import type { Idea, MapEdge, MapFeature, MapNode, PartyItem, Player, PlotBeat, RollTable, TileMap } from './types'

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub']
const KIND = 30078
const TAG = 'tableforge-v1'

export function relays(): string[] {
  try {
    const custom = localStorage.getItem('tf.relays')
    if (custom) return JSON.parse(custom)
  } catch { /* use defaults */ }
  return DEFAULT_RELAYS
}

// ---------- Codes and keys ----------

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' // no 0/O/1/I confusion

export function newSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]).join('')
  return chars.match(/.{5}/g)!.join('-')
}

/** Accepts codes typed with spaces, lowercase, or missing dashes. */
export function normalizeCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length !== 20 || [...clean].some((c) => !ALPHABET.includes(c))) return null
  return clean.match(/.{5}/g)!.join('-')
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

interface Keys { sk: Uint8Array; pk: string; aes: CryptoKey }
const keyCache = new Map<string, Promise<Keys>>()
export function keysFor(code: string): Promise<Keys> {
  let k = keyCache.get(code)
  if (!k) {
    k = (async () => {
      const sk = await sha256(`tableforge/sign/${code}`)
      const aesRaw = await sha256(`tableforge/enc/${code}`)
      const aes = await crypto.subtle.importKey('raw', aesRaw, 'AES-GCM', false, ['encrypt', 'decrypt'])
      return { sk, pk: getPublicKey(sk), aes }
    })()
    keyCache.set(code, k)
  }
  return k
}

async function seal(aes: CryptoKey, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(payload))))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv); out.set(ct, iv.length)
  return b64(out)
}

async function open(aes: CryptoKey, content: string): Promise<unknown> {
  const all = unb64(content)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, aes, all.slice(12))
  return JSON.parse(dec.decode(pt))
}

// ---------- Wire format ----------

/** Record kinds, in the order they must be applied so references resolve. */
export const KINDS = ['campaign', 'idea', 'player', 'table', 'map', 'beat', 'item', 'node', 'edge', 'feature', 'monster'] as const
export type Kind = (typeof KINDS)[number]

export interface Wire { k: Kind | 'del'; u: number; c: string; d?: boolean; r?: Record<string, unknown> }

const strip = <T extends object>(o: T, ...keys: string[]) => {
  const c = { ...o } as Record<string, unknown>
  for (const k of ['id', 'uid', 'updatedAt', 'campaignId', 'syncCode', ...keys]) delete c[k]
  return c
}

/** Builds wire records for everything in a campaign (plus shared dice tables). */
async function collect(c: CampaignRow): Promise<{ uid: string; updatedAt: number; wire: Wire }[]> {
  const cid = c.id!
  const out: { uid: string; updatedAt: number; wire: Wire }[] = []
  const push = (k: Kind, row: Synced, r: Record<string, unknown>) => out.push({ uid: row.uid, updatedAt: row.updatedAt, wire: { k, u: row.updatedAt, c: c.uid, r } })

  push('campaign', c, strip(c))
  const [ideas, beats, players, items, tables, nodes, edges, maps] = await Promise.all([
    db.ideas.where('campaignId').equals(cid).toArray(), db.beats.where('campaignId').equals(cid).toArray(),
    db.players.where('campaignId').equals(cid).toArray(), db.items.where('campaignId').equals(cid).toArray(),
    db.rollTables.filter((t) => t.campaignId === cid || t.campaignId == null).toArray(),
    db.nodes.where('campaignId').equals(cid).toArray(), db.edges.where('campaignId').equals(cid).toArray(),
    db.tileMaps.where('campaignId').equals(cid).toArray(),
  ])
  const uidOf = new Map<string, string>()
  players.forEach((p) => uidOf.set(`p${p.id}`, p.uid)); ideas.forEach((i) => uidOf.set(`i${i.id}`, i.uid))
  nodes.forEach((n) => uidOf.set(`n${n.id}`, n.uid)); maps.forEach((m) => uidOf.set(`m${m.id}`, m.uid))

  ideas.forEach((i) => push('idea', i, strip(i)))
  beats.forEach((b) => push('beat', b, strip(b)))
  players.forEach((p) => push('player', p, strip(p)))
  items.forEach((i) => push('item', i, { ...strip(i, 'holderId'), holderUid: i.holderId != null ? uidOf.get(`p${i.holderId}`) ?? null : null }))
  for (const t of tables) {
    const entries = await db.entries.where('tableId').equals(t.id!).sortBy('minRoll')
    push('table', t, { ...strip(t), shared: t.campaignId == null, entries: entries.map((e) => [e.minRoll, e.maxRoll, e.text]) })
  }
  nodes.forEach((n) => push('node', n, { ...strip(n, 'ideaId'), ideaUid: n.ideaId != null ? uidOf.get(`i${n.ideaId}`) ?? null : null }))
  edges.forEach((e) => {
    const f = uidOf.get(`n${e.fromId}`), t = uidOf.get(`n${e.toId}`)
    if (f && t) push('edge', e, { ...strip(e, 'fromId', 'toId'), fromUid: f, toUid: t })
  })
  for (const m of maps) {
    push('map', m, strip(m))
    const feats = await db.features.where('mapId').equals(m.id!).toArray()
    feats.forEach((f) => push('feature', f, { ...strip(f, 'mapId'), mapUid: m.uid }))
  }
  const monsters = await db.monsters.where('campaignId').equals(cid).toArray()
  monsters.forEach((m) => push('monster', m, strip(m)))
  const stones = await db.tombstones.where('campaignUid').equals(c.uid).toArray()
  stones.forEach((s) => out.push({ uid: s.uid, updatedAt: s.deletedAt, wire: { k: 'del', u: s.deletedAt, c: c.uid, d: true } }))
  return out
}

// ---------- Applying incoming records ----------

const tableFor = (k: Kind) =>
  ({ campaign: db.campaigns, idea: db.ideas, beat: db.beats, player: db.players, item: db.items, table: db.rollTables, node: db.nodes, edge: db.edges, map: db.tileMaps, feature: db.features, monster: db.monsters })[k]

async function findByUid(uid: string): Promise<{ kind: Kind; row: Synced & { id?: number } } | null> {
  for (const k of KINDS) {
    const row = await (tableFor(k) as unknown as { where(i: string): { equals(v: string): { first(): Promise<(Synced & { id?: number }) | undefined> } } })
      .where('uid').equals(uid).first()
    if (row) return { kind: k, row }
  }
  return null
}

async function localId(k: Kind, uid: unknown): Promise<number | null> {
  if (typeof uid !== 'string' || !uid) return null
  const t = tableFor(k) as unknown as { where(i: string): { equals(v: string): { first(): Promise<{ id?: number } | undefined> } } }
  return (await t.where('uid').equals(uid).first())?.id ?? null
}

/** Result of applying one record: applied, skipped (older), or waiting on a record it refers to. */
type ApplyResult = 'applied' | 'skipped' | 'pending'

export async function applyWire(uid: string, w: Wire, code: string): Promise<ApplyResult> {
  // Deletions
  if (w.k === 'del' || w.d) {
    const stone = await db.tombstones.get(uid)
    if (stone && stone.deletedAt >= w.u) return 'skipped'
    const found = await findByUid(uid)
    if (found && found.row.updatedAt > w.u) return 'skipped' // edited after the delete; keep
    await db.transaction('rw', [db.tombstones, db.campaigns, db.ideas, db.beats, db.players, db.items, db.rollTables, db.entries, db.nodes, db.edges, db.tileMaps, db.features, db.monsters], async () => {
      await db.tombstones.put({ uid, campaignUid: w.c, deletedAt: w.u })
      if (found && found.kind !== 'campaign') {
        const id = found.row.id!
        if (found.kind === 'table') await db.entries.where('tableId').equals(id).delete()
        if (found.kind === 'map') await db.features.where('mapId').equals(id).delete()
        if (found.kind === 'node') { await db.edges.where('fromId').equals(id).delete(); await db.edges.where('toId').equals(id).delete() }
        if (found.kind === 'player') await db.items.where('holderId').equals(id).modify({ holderId: null, attuned: false })
        await (tableFor(found.kind) as unknown as { delete(id: number): Promise<void> }).delete(id)
      }
    })
    return 'applied'
  }

  const k = w.k as Kind
  const r = w.r ?? {}
  const stone = await db.tombstones.get(uid)
  if (stone && stone.deletedAt >= w.u) return 'skipped'
  const table = tableFor(k) as unknown as {
    where(i: string): { equals(v: string): { first(): Promise<(Synced & { id?: number }) | undefined> } }
    put(row: unknown): Promise<number>
  }
  const existing = await table.where('uid').equals(uid).first()
  if (existing && existing.updatedAt >= w.u) return 'skipped'

  const base = { ...r, uid, updatedAt: w.u, ...(existing?.id != null ? { id: existing.id } : {}) }

  if (k === 'campaign') {
    const prev = existing as CampaignRow | undefined
    await db.campaigns.put({ ...(base as unknown as CampaignRow), syncCode: prev?.syncCode ?? code })
    return 'applied'
  }
  const campaignId = await localId('campaign', w.c)
  if (campaignId == null) return 'pending'

  switch (k) {
    case 'idea': case 'beat': case 'player': case 'monster':
      await table.put({ ...base, campaignId }); break
    case 'item': {
      const holderId = r.holderUid ? await localId('player', r.holderUid) : null
      if (r.holderUid && holderId == null) return 'pending'
      const row = { ...base, campaignId, holderId } as Record<string, unknown>
      delete row.holderUid
      await table.put(row); break
    }
    case 'table': {
      const { entries, shared, ...rest } = base as Record<string, unknown> & { entries?: [number, number, string][]; shared?: boolean }
      await db.transaction('rw', [db.rollTables, db.entries], async () => {
        const id = await db.rollTables.put({ ...(rest as unknown as RollTable & Synced), campaignId: shared ? null : campaignId })
        await db.entries.where('tableId').equals(id).delete()
        await db.entries.bulkAdd((entries ?? []).map(([a, b, text]) => ({ tableId: id, minRoll: a, maxRoll: b, text })))
      })
      break
    }
    case 'map':
      await table.put({ ...(base as unknown as TileMap), campaignId }); break
    case 'node': {
      const ideaId = r.ideaUid ? await localId('idea', r.ideaUid) : null
      const row = { ...base, campaignId, ideaId } as Record<string, unknown>
      delete row.ideaUid
      await table.put(row as unknown as MapNode); break
    }
    case 'edge': {
      const fromId = await localId('node', r.fromUid), toId = await localId('node', r.toUid)
      if (fromId == null || toId == null) return 'pending'
      const row = { ...base, campaignId, fromId, toId } as Record<string, unknown>
      delete row.fromUid; delete row.toUid
      await table.put(row as unknown as MapEdge); break
    }
    case 'feature': {
      const mapId = await localId('map', r.mapUid)
      if (mapId == null) return 'pending'
      const row = { ...base, mapId } as Record<string, unknown>
      delete row.mapUid
      await table.put(row as unknown as MapFeature); break
    }
  }
  return 'applied'
}

// Keep TS honest about the shapes we write.
export type _Shapes = Idea | PlotBeat | Player | PartyItem | Tombstone

// ---------- Relay connections ----------

type Status = 'off' | 'connecting' | 'live' | 'offline'
export interface SyncState { status: Status; relaysUp: number; relaysTotal: number; lastSync: number | null; pendingPush: number; error: string | null }

class Relay {
  ws: WebSocket | null = null
  up = false
  private queue: string[] = []
  private backoff = 1000
  private closed = false
  constructor(public url: string, private onMsg: (r: Relay, m: unknown[]) => void, private onState: () => void, private onOpen: (r: Relay) => void) {
    this.connect()
  }
  private connect() {
    if (this.closed) return
    try { this.ws = new WebSocket(this.url) } catch { this.retry(); return }
    this.ws.onopen = () => {
      this.up = true; this.backoff = 1000; this.onState()
      this.onOpen(this)
      const q = this.queue; this.queue = []
      q.forEach((m) => this.send(m))
    }
    this.ws.onmessage = (e) => { try { this.onMsg(this, JSON.parse(String(e.data))) } catch { /* ignore junk */ } }
    this.ws.onclose = () => { this.up = false; this.onState(); this.retry() }
    this.ws.onerror = () => { try { this.ws?.close() } catch { /* already closed */ } }
  }
  private retry() {
    if (this.closed) return
    setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, 60_000)
  }
  send(msg: string) {
    if (this.up && this.ws?.readyState === WebSocket.OPEN) this.ws.send(msg)
    else if (!msg.startsWith('["EVENT"')) this.queue.push(msg) // events are re-sent by the pusher
  }
  close() { this.closed = true; try { this.ws?.close() } catch { /* ignore */ } }
}

/** Keeps one linked campaign in sync. */
export class CampaignSync {
  private relays: Relay[] = []
  private keys!: Keys
  private pushed: Record<string, number> = {}
  private lastCreated: Record<string, number> = {}
  private pendingIncoming = new Map<string, Wire>()
  /** What each relay returned during its initial load: uid -> record time. Used to heal gaps. */
  private seen = new Map<Relay, Map<string, number>>()
  private inFlight = new Map<string, { uid: string; u: number; acks: number; at: number }>()
  private pushTimer: number | undefined
  private pollTimer: number | undefined
  private applying = Promise.resolve()
  private stopped = false
  state: SyncState = { status: 'connecting', relaysUp: 0, relaysTotal: 0, lastSync: null, pendingPush: 0, error: null }
  onState: (s: SyncState) => void = () => {}
  onFound: () => void = () => {}
  onEose: () => void = () => {}
  eoseCount = 0

  constructor(public code: string, public campaignUid: string | null) {}

  private storeKey = () => `tf.sync.${this.code}`
  private load() {
    try {
      const s = JSON.parse(localStorage.getItem(this.storeKey()) || '{}')
      this.pushed = s.pushed ?? {}; this.lastCreated = s.lastCreated ?? {}; this.state.lastSync = s.lastSync ?? null
    } catch { /* fresh */ }
  }
  private persist() {
    try { localStorage.setItem(this.storeKey(), JSON.stringify({ pushed: this.pushed, lastCreated: this.lastCreated, lastSync: this.state.lastSync })) } catch { /* full or private */ }
  }
  private emit(patch: Partial<SyncState> = {}) {
    const up = this.relays.filter((r) => r.up).length
    this.state = { ...this.state, ...patch, relaysUp: up, relaysTotal: this.relays.length }
    if (!this.stopped && this.state.status !== 'off') this.state.status = up > 0 ? 'live' : navigator.onLine ? 'connecting' : 'offline'
    this.onState(this.state)
  }

  async start() {
    this.load()
    this.keys = await keysFor(this.code)
    this.relays = relays().map((u) => new Relay(u, (r, m) => this.onMessage(r, m), () => this.emit(), (r) => this.subscribe(r)))
    this.emit()
    this.pollTimer = window.setInterval(() => { this.schedulePush(0); this.retryPending() }, 20_000)
  }

  stop() {
    this.stopped = true
    this.relays.forEach((r) => r.close())
    window.clearInterval(this.pollTimer); window.clearTimeout(this.pushTimer)
    this.state = { ...this.state, status: 'off' }
    this.onState(this.state)
  }

  private subscribe(r: Relay) {
    this.seen.set(r, new Map())
    r.send(JSON.stringify(['REQ', 'tf', { kinds: [KIND], authors: [this.keys.pk], '#t': [TAG], limit: 5000 }]))
    this.schedulePush(300)
  }

  private onMessage(relay: Relay, m: unknown[]) {
    const [type] = m as [string]
    if (type === 'EVENT') {
      const ev = m[2] as NostrEvent
      if (!ev || ev.pubkey !== this.keys.pk || ev.kind !== KIND) return
      this.applying = this.applying.then(() => this.receive(ev, relay)).catch(() => {})
    } else if (type === 'EOSE') {
      this.applying = this.applying.then(() => this.retryPending()).then(() => this.heal(relay)).then(() => {
        this.eoseCount++
        this.emit({ lastSync: Date.now(), error: null }); this.persist()
        this.onEose()
      }).catch(() => {})
    } else if (type === 'OK') {
      const [, id, ok] = m as [string, string, boolean, string]
      const f = this.inFlight.get(id)
      if (f && ok) {
        f.acks++
        if ((this.pushed[f.uid] ?? 0) < f.u) { this.pushed[f.uid] = f.u; this.persist() }
        this.emit({ pendingPush: [...this.inFlight.values()].filter((x) => x.acks === 0).length, lastSync: Date.now() })
      }
    } else if (type === 'NOTICE' || type === 'CLOSED') {
      // Relays sometimes complain (rate limits, etc.). Other relays cover for it.
      void relay
    }
  }

  private async receive(ev: NostrEvent, relay?: Relay) {
    if (!verifyEvent(ev)) return
    const uid = ev.tags.find((t) => t[0] === 'd')?.[1]
    if (!uid) return
    let w: Wire
    try { w = (await open(this.keys.aes, ev.content)) as Wire } catch { return }
    this.lastCreated[uid] = Math.max(this.lastCreated[uid] ?? 0, ev.created_at)
    const seen = relay && this.seen.get(relay)
    if (seen) seen.set(uid, Math.max(seen.get(uid) ?? 0, w.u))
    if (this.campaignUid == null && w.k === 'campaign') { this.campaignUid = uid }
    const res = await applyWire(uid, w, this.code)
    if (res === 'pending') this.pendingIncoming.set(uid, w)
    else {
      this.pendingIncoming.delete(uid)
      if ((this.pushed[uid] ?? 0) < w.u && res === 'applied') this.pushed[uid] = w.u // already on the relays
      if (res === 'applied' && w.k === 'campaign') this.onFound()
    }
  }

  private async retryPending() {
    for (let pass = 0; pass < 4 && this.pendingIncoming.size; pass++) {
      const order = [...this.pendingIncoming.entries()].sort((a, b) => KINDS.indexOf(a[1].k as Kind) - KINDS.indexOf(b[1].k as Kind))
      for (const [uid, w] of order) {
        const res = await applyWire(uid, w, this.code)
        if (res !== 'pending') { this.pendingIncoming.delete(uid); if (res === 'applied') this.pushed[uid] = Math.max(this.pushed[uid] ?? 0, w.u) }
      }
    }
  }

  private async eventFor(d: { uid: string; wire: Wire }) {
    const created = Math.max(Math.floor(Date.now() / 1000), (this.lastCreated[d.uid] ?? 0) + 1)
    this.lastCreated[d.uid] = created
    return finalizeEvent({ kind: KIND, created_at: created, tags: [['d', d.uid], ['t', TAG]], content: await seal(this.keys.aes, d.wire) }, this.keys.sk)
  }

  /**
   * After a relay finishes sending what it has, re-send anything it's missing or has an
   * older copy of. This repairs relays that dropped data and seeds relays added later.
   */
  private async heal(relay: Relay) {
    if (this.stopped || !this.campaignUid || !relay.up) return
    const seen = this.seen.get(relay)
    if (!seen) return
    this.seen.delete(relay) // live events after EOSE aren't part of the comparison
    const c = await db.campaigns.where('uid').equals(this.campaignUid).first()
    if (!c) return
    const missing = (await collect(c)).filter((x) => (seen.get(x.uid) ?? 0) < x.updatedAt)
    for (const d of missing) {
      const ev = await this.eventFor(d)
      this.inFlight.set(ev.id, { uid: d.uid, u: d.updatedAt, acks: 0, at: Date.now() })
      relay.send(JSON.stringify(['EVENT', ev]))
      await new Promise((res) => setTimeout(res, 60))
    }
    this.persist()
  }

  /** Pushes local changes soon (debounced). */
  schedulePush(delay = 1200) {
    window.clearTimeout(this.pushTimer)
    this.pushTimer = window.setTimeout(() => { this.applying = this.applying.then(() => this.push()).catch(() => {}) }, delay)
  }

  private async push() {
    if (this.stopped || !this.campaignUid) return
    const c = await db.campaigns.where('uid').equals(this.campaignUid).first()
    if (!c) return
    const all = await collect(c)
    const dirty = all.filter((x) => (this.pushed[x.uid] ?? 0) < x.updatedAt)
    // Forget in-flight events that never got an OK so they're retried.
    const cutoff = Date.now() - 15_000
    for (const [id, f] of this.inFlight) if (f.acks > 0 || f.at < cutoff) this.inFlight.delete(id)
    this.emit({ pendingPush: dirty.length })
    if (!dirty.length || !this.relays.some((r) => r.up)) return
    for (const d of dirty) {
      if ([...this.inFlight.values()].some((f) => f.uid === d.uid && f.u >= d.updatedAt)) continue
      const ev = await this.eventFor(d)
      this.inFlight.set(ev.id, { uid: d.uid, u: d.updatedAt, acks: 0, at: Date.now() })
      const msg = JSON.stringify(['EVENT', ev])
      this.relays.forEach((r) => r.send(msg))
      await new Promise((res) => setTimeout(res, 60)) // be gentle with relay rate limits
    }
    this.persist()
  }
}

// ---------- Manager: one CampaignSync per linked campaign ----------

const active = new Map<string, CampaignSync>()
const stateSubs = new Set<() => void>()
const states = new Map<string, SyncState>()
export const syncStates = () => states
export const onSyncState = (f: () => void) => { stateSubs.add(f); return () => { stateSubs.delete(f) } }
const notify = () => stateSubs.forEach((f) => f())

export function startSync(code: string, campaignUid: string | null, onFound?: () => void): CampaignSync {
  let s = active.get(code)
  if (!s) {
    s = new CampaignSync(code, campaignUid)
    s.onState = (st) => { states.set(code, st); notify() }
    active.set(code, s)
    void s.start()
  }
  if (onFound) s.onFound = onFound
  if (campaignUid && !s.campaignUid) s.campaignUid = campaignUid
  return s
}

export function stopSync(code: string) {
  active.get(code)?.stop()
  active.delete(code)
  states.delete(code)
  notify()
}

export function pushAllSoon() { active.forEach((s) => s.schedulePush()) }

/** Starts sync for every linked campaign on this device. */
export async function resumeAll() {
  const linked = await db.campaigns.filter((c) => !!c.syncCode).toArray()
  linked.forEach((c) => startSync(c.syncCode!, c.uid))
}

/** Links a campaign that exists on this device to a new code and uploads it. */
export async function linkCampaign(c: CampaignRow): Promise<string> {
  const code = newSyncCode()
  await db.campaigns.update(c.id!, { syncCode: code })
  startSync(code, c.uid).schedulePush(100)
  return code
}

/** Joins a campaign from another device. Resolves when its campaign record arrives. */
export function joinCampaign(code: string, timeoutMs = 25_000): Promise<CampaignRow> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = async () => {
      if (done) return
      const s = active.get(code)
      const uid = s?.campaignUid
      const c = uid ? await db.campaigns.where('uid').equals(uid).first() : undefined
      if (c) { done = true; await db.campaigns.update(c.id!, { syncCode: code }); resolve({ ...c, syncCode: code }) }
    }
    const s = startSync(code, null, () => { void finish() })
    void finish()
    const fail = () => {
      if (done) return
      done = true
      if (!s.campaignUid) stopSync(code)
      reject(new Error(s.state.relaysUp === 0
        ? "Couldn't reach the sync relays. Check the internet connection and try again."
        : 'No campaign found for that code. Check it was typed correctly and that the other device has synced at least once.'))
    }
    // Once a couple of relays have sent everything they hold and the campaign isn't there, say so quickly.
    s.onEose = () => {
      if (!done && !s.campaignUid && s.eoseCount >= Math.min(2, Math.max(1, s.state.relaysTotal))) setTimeout(() => { void finish().then(() => { if (!s.campaignUid) fail() }) }, 3000)
    }
    setTimeout(fail, timeoutMs)
  })
}

export async function unlinkCampaign(c: CampaignRow) {
  if (c.syncCode) stopSync(c.syncCode)
  await db.campaigns.update(c.id!, { syncCode: undefined })
}

export const _testing = { now }
