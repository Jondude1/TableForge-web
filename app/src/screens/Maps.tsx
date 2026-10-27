import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, remove, save, type FeatureRow, type TileMapRow } from '../lib/db'
import { blankTerrain, build, cellName, colName, iconFor, paint, rectLabel, spanning, type GridRect } from '../lib/mapforge'
import { friendly } from '../lib/ai'
import { aiReady, useAi } from '../lib/settings'
import { TERRAINS, terrainByCode, type Terrain } from '../lib/types'
import { useApp } from '../store'
import { Confirm, Empty, Field, FormModal, Header, Icon, Label, LabeledBody, Seg, Select, useWide } from '../ui'
import { useKept } from './keep'
import { useView } from './board'

const CELL = 44
const M = 26 // margin for coordinate labels

const SUGGESTIONS = [
  'A lighthouse that takes up 4 squares',
  'A river running north to south through here',
  'A goblin camp with 3 tents around a campfire',
  'Make this whole area a swamp',
  'A ruined watchtower with a hidden cellar',
  'A small fishing dock with two rowboats',
]

interface Undo { mapId: number; terrain: string; added: string[]; removed: FeatureRow[] }
interface Status { loading?: boolean; error?: string; summary?: string; canUndo?: boolean }

export default function Maps() {
  const { campaignId } = useApp()
  const maps = useLiveQuery(() => db.tileMaps.where('campaignId').equals(campaignId).sortBy('createdAt'), [campaignId])
  const [mapId, setMapId] = useKept<number | null>(`maps.${campaignId}.sel`, null)
  const [creating, setCreating] = useState(false)
  const map = maps?.find((m) => m.id === mapId) ?? maps?.[0]

  useEffect(() => { if (map && map.id !== mapId) setMapId(map.id!) }, [map, mapId, setMapId])

  if (!maps) return null
  return (
    <>
      {!map ? (
        <div className="scroll">
          <Header title="Maps" sub="Grid maps you build by tapping and asking" />
          <Empty icon="maps" title="Start a map" body={'Make a grid, tap any square (or press and hold, then drag over an area), and describe what goes there — "a lighthouse that takes up 4 squares". It gets placed, sized and described for you.'}>
            <button className="btn primary" onClick={() => setCreating(true)}>New map</button>
          </Empty>
        </div>
      ) : (
        <Workspace key={map.id} map={map} maps={maps} onSwitch={setMapId} onNew={() => setCreating(true)} />
      )}
      {creating && <NewMap onClose={() => setCreating(false)} onCreate={async (name, cols, rows, base, feet) => {
        const id = await save(db.tileMaps, { campaignId, name, cols, rows, terrain: blankTerrain(cols, rows, base), feetPerSquare: feet, notes: '', createdAt: Date.now(), uid: '', updatedAt: 0 })
        setMapId(id); setCreating(false)
      }} />}
    </>
  )
}

function Workspace({ map, maps, onSwitch, onNew }: { map: TileMapRow; maps: TileMapRow[]; onSwitch: (id: number) => void; onNew: () => void }) {
  const { buildCtx, toast } = useApp()
  const ai = useAi()
  const wide = useWide()
  const features = useLiveQuery(() => db.features.where('mapId').equals(map.id!).toArray(), [map.id]) ?? []
  const [sel, setSel] = useState<GridRect | null>(null)
  const [selFeature, setSelFeature] = useState<number | null>(null)
  const [mode, setMode] = useKept<'ask' | 'paint'>('maps.mode', 'ask')
  const [brush, setBrush] = useKept<string>('maps.brush', 'w')
  const [request, setRequest] = useKept('maps.request', '')
  const [status, setStatus] = useState<Status>({})
  const [undo, setUndo] = useState<Undo | null>(null)
  const [editingFeature, setEditingFeature] = useState<FeatureRow | null>(null)
  const [editingInfo, setEditingInfo] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [fitKey, setFitKey] = useState(0)
  const ready = aiReady(ai)
  const feature = features.find((f) => f.id === selFeature) ?? null
  const sorted = [...features].sort((a, b) => b.w * b.h - a.w * a.h)

  const hitAt = (x: number, y: number) => [...sorted].reverse().find((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h)

  const paintRect = async (r: GridRect) => {
    const t = terrainByCode(brush)
    const cells: [number, number][] = []
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push([x, y])
    setUndo({ mapId: map.id!, terrain: map.terrain, added: [], removed: [] })
    await save(db.tileMaps, { ...map, terrain: paint(map, [{ terrain: t, cells }]) })
    setStatus({ summary: `Painted ${rectLabel(r)} as ${t.label.toLowerCase()}.`, canUndo: true })
  }

  const onTap = (x: number, y: number) => {
    if (mode === 'paint') { void paintRect({ x, y, w: 1, h: 1 }); return }
    const hit = hitAt(x, y)
    if (hit && hit.id !== selFeature) { setSelFeature(hit.id!); setSel({ x: hit.x, y: hit.y, w: hit.w, h: hit.h }) }
    else { setSelFeature(null); setSel({ x, y, w: 1, h: 1 }) }
  }

  const send = async () => {
    if (!sel || !request.trim()) return
    setStatus({ loading: true })
    try {
      const fresh = await db.tileMaps.get(map.id!)
      if (!fresh) return
      const existing = await db.features.where('mapId').equals(map.id!).toArray()
      const edit = await build(ai, await buildCtx(), fresh, existing, sel, request.trim())
      const removed = existing.filter((f) => edit.removeUids.includes(f.uid))
      for (const f of removed) await remove(db.features, f, map.campaignId)
      if (edit.terrain.length) await save(db.tileMaps, { ...fresh, terrain: paint(fresh, edit.terrain) })
      const added: string[] = []
      for (const f of edit.features) {
        const id = await save(db.features, { ...f, mapId: map.id!, createdAt: Date.now(), uid: '', updatedAt: 0 })
        const row = await db.features.get(id); if (row) added.push(row.uid)
      }
      setUndo({ mapId: map.id!, terrain: fresh.terrain, added, removed })
      const summary = edit.summary || [
        edit.features.length && `Added ${edit.features.map((f) => f.name).join(', ')}`,
        edit.terrain.length && `repainted ${edit.terrain.reduce((n, p) => n + p.cells.length, 0)} squares`,
        removed.length && `removed ${removed.length}`,
      ].filter(Boolean).join('; ') + '.'
      setStatus({ summary, canUndo: true })
      setRequest('')
      if (edit.features.length === 1) {
        const f = edit.features[0]
        setSel({ x: f.x, y: f.y, w: f.w, h: f.h })
        const row = await db.features.where('uid').equals(added[0]).first()
        if (row) setSelFeature(row.id!)
      }
    } catch (e) {
      setStatus({ error: friendly(e) })
    }
  }

  const doUndo = async () => {
    const u = undo
    if (!u) return
    setUndo(null)
    for (const uid of u.added) { const f = await db.features.where('uid').equals(uid).first(); if (f) await remove(db.features, f, map.campaignId) }
    for (const f of u.removed) { await db.tombstones.delete(f.uid); await save(db.features, { ...f, id: undefined }) }
    const m = await db.tileMaps.get(u.mapId)
    if (m && m.terrain !== u.terrain) await save(db.tileMaps, { ...m, terrain: u.terrain })
    setSelFeature(null)
    setStatus({ summary: 'Undone.' })
  }

  const addPlain = async () => {
    if (!sel || !request.trim()) return
    const name = request.trim()
    const id = await save(db.features, { mapId: map.id!, ...sel, name, kind: name.toLowerCase(), icon: iconFor(name), color: '', description: '', createdAt: Date.now(), uid: '', updatedAt: 0 })
    const row = await db.features.get(id)
    setUndo({ mapId: map.id!, terrain: map.terrain, added: row ? [row.uid] : [], removed: [] })
    setStatus({ summary: `Added ${name} at ${rectLabel(sel)}.`, canUndo: true })
    setRequest('')
  }

  const canvas = (
    <MapBoard map={map} features={sorted} sel={sel} selFeature={selFeature} fitKey={fitKey} allowMove={mode === 'ask'} paintMode={mode === 'paint'}
      onTap={onTap}
      onArea={(r) => { setSelFeature(null); if (mode === 'paint') void paintRect(r); else setSel(r) }}
      onMoved={async (f, x, y) => { await save(db.features, { ...f, x, y }); setSel({ x, y, w: f.w, h: f.h }); setSelFeature(f.id!) }}
      onFit={() => setFitKey(fitKey + 1)} />
  )

  const panel = (
    <div className="stack-l" style={{ padding: wide ? 20 : 14 }}>
      <MapPicker map={map} maps={maps} onSwitch={onSwitch} onNew={onNew} onInfo={() => setEditingInfo(true)} onDelete={() => setDeleting(true)} />
      <Seg value={mode} onChange={(m) => { setMode(m); if (m === 'paint') setSelFeature(null) }}
        options={[{ value: 'ask', label: <><Icon n="send" s={16} />Build</> }, { value: 'paint', label: <><Icon n="brush" s={16} />Paint</> }]} />
      {(status.loading || status.error || status.summary) && (
        <div className={`banner${status.error ? '' : ' ok'}`} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {status.loading ? <><span className="spinner" style={{ color: 'var(--gold)' }} /><span className="grow">Building it…</span></> : <>
            <span className="grow">{status.error ?? status.summary}</span>
            {status.canUndo && undo && <button className="btn ghost sm" onClick={doUndo}><Icon n="undo" s={16} />Undo</button>}
            <button className="btn ghost sm" onClick={() => setStatus({})}>OK</button>
          </>}
        </div>
      )}
      {mode === 'paint' ? (
        <div className="stack">
          <Label>Terrain brush</Label>
          <div className="chips">
            {TERRAINS.map((t) => (
              <button key={t.code} className={`chip${t.code === brush ? ' on' : ''}`} onClick={() => setBrush(t.code)}>
                <span className="swatch" style={{ background: t.color }} />{t.label}
              </button>
            ))}
          </div>
          <div className="muted tiny">Tap squares to paint, or press and hold then drag to paint an area. Use Build to describe bigger terrain changes in words.</div>
        </div>
      ) : (
        <>
          {feature && (
            <div className="card stack" style={{ borderColor: feature.color || 'var(--seam)' }}>
              <div className="row">
                <span style={{ fontSize: 30, lineHeight: 1 }}>{feature.icon}</span>
                <div className="grow">
                  <div className="title">{feature.name}</div>
                  <div className="muted tiny">{[feature.kind, rectLabel(feature)].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              {feature.description && <LabeledBody body={feature.description} />}
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                <button className="btn tonal sm" onClick={() => setEditingFeature(feature)}>Edit</button>
                <button className="btn ghost sm" onClick={() => setRequest(`Change ${feature.name}: `)}>Change…</button>
                <button className="btn ghost sm" onClick={async () => {
                  await save(db.ideas, { campaignId: map.campaignId, type: 'LOCATION', title: feature.name, body: feature.description, tags: feature.kind, isOwn: false, favorite: false, used: false, createdAt: Date.now(), uid: '', updatedAt: 0 })
                  toast(`Saved ${feature.name} to Ideas`)
                }}>Save idea</button>
                <div className="grow" />
                <button className="icon-btn" style={{ color: 'var(--error)' }} aria-label="Remove from map" onClick={async () => {
                  await remove(db.features, feature, map.campaignId)
                  setUndo({ mapId: map.id!, terrain: map.terrain, added: [], removed: [feature] })
                  setStatus({ summary: `Removed ${feature.name}.`, canUndo: true }); setSelFeature(null)
                }}><Icon n="trash" /></button>
              </div>
            </div>
          )}
          <div className="stack">
            <Label>{sel ? `Add at ${rectLabel(sel)}` : 'Pick a spot'}</Label>
            {!sel && <div className="muted small">Tap a square on the map, or press and hold then drag to mark an area.</div>}
            <textarea className="textarea" rows={3} value={request} disabled={status.loading} onChange={(e) => setRequest(e.target.value)}
              placeholder="What should go here? Anything — a lighthouse, a river, a dragon's hoard…" />
            <div className="chips scrollx">
              {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => setRequest(s)}>{s}</button>)}
            </div>
            <div className="row">
              <button className="btn primary grow" style={{ height: 48 }} disabled={!sel || !request.trim() || status.loading} onClick={send}>
                {status.loading ? <span className="spinner" /> : <Icon n="send" s={18} />}{ready ? 'Ask Claude' : 'Add'}
              </button>
              {ready && <button className="btn outline" style={{ height: 48 }} disabled={!sel || !request.trim() || status.loading} onClick={addPlain}>Just label it</button>}
            </div>
            {!ready && <div className="muted tiny">Offline mode understands sizes like "4 squares" or "3x2" and "make this water". Add a Claude API key in Settings to ask for anything.</div>}
          </div>
        </>
      )}
      {features.length > 0 && (
        <div className="stack">
          <Label>On this map · {features.length}</Label>
          {[...features].sort((a, b) => a.y * map.cols + a.x - (b.y * map.cols + b.x)).map((f) => (
            <button key={f.id} className="row" style={{ background: 'none', border: 0, padding: '4px 0', textAlign: 'left' }}
              onClick={() => { setMode('ask'); setSelFeature(f.id!); setSel({ x: f.x, y: f.y, w: f.w, h: f.h }) }}>
              <span style={{ width: 28, fontSize: 19 }}>{f.icon}</span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span className="muted tiny" style={{ fontFamily: 'var(--ui)' }}>{rectLabel(f)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      {wide ? (
        <div className="split"><div className="body" style={{ overflow: 'hidden' }}>{canvas}</div><div className="side right" style={{ width: 380 }}>{panel}</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: 1.15, minHeight: 0 }}>{canvas}</div>
          <div className="panel" style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: '1px solid var(--seam-soft)' }}>{panel}</div>
        </div>
      )}
      {editingFeature && <FeatureDialog f={editingFeature} map={map} onClose={() => setEditingFeature(null)} onSave={async (f) => { await save(db.features, f); setEditingFeature(null); setSel({ x: f.x, y: f.y, w: f.w, h: f.h }) }} />}
      {editingInfo && <InfoDialog map={map} onClose={() => setEditingInfo(false)} />}
      {deleting && <Confirm title={`Delete "${map.name}"?`} body="The map and everything on it will be removed."
        onConfirm={async () => { for (const f of features) await remove(db.features, f, map.campaignId); await remove(db.tileMaps, map) }} onClose={() => setDeleting(false)} />}
    </>
  )
}

// ---------- The board ----------

interface BoardProps {
  map: TileMapRow; features: FeatureRow[]; sel: GridRect | null; selFeature: number | null; fitKey: number; allowMove: boolean; paintMode: boolean
  onTap: (x: number, y: number) => void; onArea: (r: GridRect) => void; onMoved: (f: FeatureRow, x: number, y: number) => void; onFit: () => void
}

function MapBoard({ map, features, sel, selFeature, fitKey, allowMove, paintMode, onTap, onArea, onMoved, onFit }: BoardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const W = M + map.cols * CELL, H = M + map.rows * CELL
  const { view, setView, zoomAt, toContent, down, move, up, panBy } = useView({ scale: 1, x: 0, y: 0 }, 0.2, 4)
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number]; f?: FeatureRow } | null>(null)
  const g = useRef<{ id: number; sx: number; sy: number; lx: number; ly: number; mode: 'tap' | 'pan' | 'long'; timer?: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const fitAll = Math.min(r.width / (W + M), r.height / (H + M))
      // On small screens keep squares big enough to tap (about 26px) and start at the top-left corner.
      const minTap = 26 / CELL
      const s = Math.min(Math.max(fitAll, window.innerWidth < 760 ? minTap : 0.2), 2.5)
      const x = W * s <= r.width ? (r.width - W * s) / 2 : 8
      const y = H * s <= r.height ? (r.height - H * s) / 2 : 8
      setView({ scale: s, x, y })
    }
    fit()
    if (fitKey === 0) {
      const ro = new ResizeObserver(() => { if (!g.current) fit() })
      ro.observe(el)
      const t = setTimeout(() => ro.disconnect(), 800) // only refit while the layout settles
      return () => { ro.disconnect(); clearTimeout(t) }
    }
  }, [map.id, fitKey, W, H, setView])

  const rel = (e: React.PointerEvent | React.WheelEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const cellAt = (px: number, py: number, clamp = false): [number, number] | null => {
    const c = toContent(px, py)
    let x = Math.floor((c.x - M) / CELL), y = Math.floor((c.y - M) / CELL)
    if (clamp) { x = Math.max(0, Math.min(map.cols - 1, x)); y = Math.max(0, Math.min(map.rows - 1, y)) }
    return x >= 0 && y >= 0 && x < map.cols && y < map.rows ? [x, y] : null
  }
  const featureAt = ([x, y]: [number, number]) => [...features].reverse().find((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h)

  const cancelTimer = () => { if (g.current?.timer) { clearTimeout(g.current.timer); g.current.timer = undefined } }

  const onDown = (e: React.PointerEvent) => {
    const p = rel(e)
    ref.current?.setPointerCapture(e.pointerId)
    if (down(e.pointerId, p.x, p.y)) { cancelTimer(); g.current = null; setDrag(null); return }
    const s = { id: e.pointerId, sx: p.x, sy: p.y, lx: p.x, ly: p.y, mode: 'tap' as const, timer: undefined as number | undefined }
    g.current = s
    s.timer = window.setTimeout(() => {
      if (g.current !== s || s.mode !== 'tap') return
      const c = cellAt(s.sx, s.sy)
      if (!c) return
      ;(g.current as { mode: string }).mode = 'long'
      navigator.vibrate?.(12)
      const f = allowMove ? featureAt(c) : undefined
      setDrag({ a: c, b: c, f })
    }, 420)
  }
  const onMove = (e: React.PointerEvent) => {
    const p = rel(e)
    if (move(e.pointerId, p.x, p.y)) return
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    if (s.mode === 'tap' && Math.hypot(p.x - s.sx, p.y - s.sy) > 8) { cancelTimer(); s.mode = 'pan' }
    if (s.mode === 'pan') panBy(p.x - s.lx, p.y - s.ly)
    else if (s.mode === 'long') { const c = cellAt(p.x, p.y, true)!; setDrag((d) => (d ? { ...d, b: c } : d)) }
    s.lx = p.x; s.ly = p.y
  }
  const onUp = (e: React.PointerEvent) => {
    up(e.pointerId)
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    cancelTimer()
    g.current = null
    if (s.mode === 'tap') { const c = cellAt(s.sx, s.sy); if (c) onTap(c[0], c[1]) }
    else if (s.mode === 'long' && drag) {
      const { a, b, f } = drag
      if (f) {
        const nx = Math.max(0, Math.min(map.cols - f.w, f.x + b[0] - a[0])), ny = Math.max(0, Math.min(map.rows - f.h, f.y + b[1] - a[1]))
        if (nx !== f.x || ny !== f.y) onMoved(f, nx, ny)
      } else onArea(spanning(a[0], a[1], b[0], b[1]))
    }
    setDrag(null)
  }

  const shown = drag && !drag.f ? spanning(drag.a[0], drag.a[1], drag.b[0], drag.b[1]) : sel
  const offset = (f: FeatureRow) => {
    const d = drag
    return d && d.f?.id === f.id
      ? { x: Math.max(0, Math.min(map.cols - f.w, f.x + d.b[0] - d.a[0])), y: Math.max(0, Math.min(map.rows - f.h, f.y + d.b[1] - d.a[1])) }
      : { x: f.x, y: f.y }
  }

  return (
    <div ref={ref} className="board" style={{ background: '#110D09' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onWheel={(e) => { const p = rel(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1) }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="layer" style={{ width: W, height: H, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <Grid map={map} />
        {features.map((f) => {
          const o = offset(f), color = f.color || '#D4A84B'
          const small = f.w === 1 && f.h === 1
          return (
            <div key={f.id} className={`token${f.id === selFeature ? ' sel' : ''}${drag?.f?.id === f.id ? ' lift' : ''}`}
              style={{ left: M + o.x * CELL, top: M + o.y * CELL, width: f.w * CELL, height: f.h * CELL }}>
              <div style={{ background: `${color}4d`, borderColor: color }}>
                <span className="em" style={{ fontSize: small ? 22 : Math.min(30, 16 + Math.min(f.w, f.h) * 5) }}>{f.icon || '⭐'}</span>
                {!small && <span className="nm">{f.name}</span>}
              </div>
            </div>
          )
        })}
        {shown && (
          <div style={{ position: 'absolute', left: M + shown.x * CELL, top: M + shown.y * CELL, width: shown.w * CELL, height: shown.h * CELL, border: '3px solid var(--gold)', background: 'rgba(212,168,75,.16)', borderRadius: 3, pointerEvents: 'none' }} />
        )}
      </div>
      <div className="hint"><Icon n="touch" s={15} />{paintMode ? 'Tap or hold + drag to paint · pinch to zoom' : 'Tap a square · hold + drag for an area · hold a feature to move it'}</div>
      <button className="icon-btn fab" style={{ background: 'var(--leather-hi)' }} onPointerDown={(e) => e.stopPropagation()} onClick={onFit} aria-label="Fit map to screen"><Icon n="fit" /></button>
    </div>
  )
}

/** Terrain, grid and coordinate labels. Memoized: only redraws when the terrain changes. */
const Grid = memo(function Grid({ map }: { map: TileMapRow }) {
  const W = M + map.cols * CELL, H = M + map.rows * CELL
  const cells: JSX.Element[] = []
  for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
    const t = terrainByCode(map.terrain[y * map.cols + x] ?? 'g')
    const X = M + x * CELL, Y = M + y * CELL
    cells.push(<rect key={`${x},${y}`} x={X} y={Y} width={CELL + 0.5} height={CELL + 0.5} fill={t.color} opacity={(x + y) % 2 ? 0.94 : 1} />)
    const k = `d${x},${y}`
    if (t.key === 'forest') cells.push(<g key={k} fill="#1A2915"><circle cx={X + CELL * 0.32} cy={Y + CELL * 0.36} r={CELL * 0.18} /><circle cx={X + CELL * 0.66} cy={Y + CELL * 0.62} r={CELL * 0.15} /></g>)
    else if (t.key === 'water' || t.key === 'deep') cells.push(<path key={k} d={`M${X + 9} ${Y + 18}h11M${X + 24} ${Y + 30}h11`} stroke="rgba(255,255,255,.13)" strokeWidth="2" />)
    else if (t.key === 'wall') cells.push(<path key={k} d={`M${X} ${Y}l${CELL} ${CELL}M${X + CELL / 2} ${Y}l${CELL / 2} ${CELL / 2}M${X} ${Y + CELL / 2}l${CELL / 2} ${CELL / 2}`} stroke="rgba(255,255,255,.06)" strokeWidth="2" />)
    else if (t.key === 'mountain') cells.push(<path key={k} d={`M${X + 9} ${Y + 33}L${X + 22} ${Y + 13}L${X + 35} ${Y + 33}`} stroke="rgba(0,0,0,.25)" strokeWidth="3" fill="none" />)
    else if (t.key === 'swamp') cells.push(<circle key={k} cx={X + 26} cy={Y + 20} r={6} fill="rgba(43,58,64,.6)" />)
    else if (t.key === 'lava') cells.push(<circle key={k} cx={X + 18} cy={Y + 24} r={5} fill="rgba(242,163,58,.45)" />)
  }
  const lines: JSX.Element[] = []
  for (let x = 0; x <= map.cols; x++) lines.push(<line key={`v${x}`} x1={M + x * CELL} y1={M} x2={M + x * CELL} y2={H} />)
  for (let y = 0; y <= map.rows; y++) lines.push(<line key={`h${y}`} x1={M} y1={M + y * CELL} x2={W} y2={M + y * CELL} />)
  const dots: JSX.Element[] = []
  for (let x = 0; x <= map.cols; x++) for (let y = 0; y <= map.rows; y++) dots.push(<circle key={`${x}.${y}`} cx={M + x * CELL} cy={M + y * CELL} r={1.4} />)
  return (
    <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }} shapeRendering="crispEdges">
      {cells}
      <g stroke="rgba(0,0,0,.28)" strokeWidth="1">{lines}</g>
      <g fill="rgba(212,168,75,.22)" shapeRendering="auto">{dots}</g>
      <rect x={M} y={M} width={W - M} height={H - M} fill="none" stroke="rgba(212,168,75,.55)" strokeWidth="2" />
      <g fill="#B9AB92" fontFamily="Cinzel, serif" fontWeight="700" fontSize="12" textAnchor="middle" shapeRendering="auto">
        {Array.from({ length: map.cols }, (_, x) => <text key={`c${x}`} x={M + x * CELL + CELL / 2} y={M * 0.68}>{colName(x)}</text>)}
        {Array.from({ length: map.rows }, (_, y) => <text key={`r${y}`} x={M / 2} y={M + y * CELL + CELL / 2 + 4}>{y + 1}</text>)}
      </g>
    </svg>
  )
}, (a, b) => a.map.terrain === b.map.terrain && a.map.cols === b.map.cols && a.map.rows === b.map.rows)

// ---------- Panels and dialogs ----------

function MapPicker({ map, maps, onSwitch, onNew, onInfo, onDelete }: { map: TileMapRow; maps: TileMapRow[]; onSwitch: (id: number) => void; onNew: () => void; onInfo: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="row" style={{ position: 'relative' }}>
      <button className="grow row" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => setOpen(!open)}>
        <div className="grow">
          <h2 className="h2" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{map.name}</h2>
          <div className="muted tiny">{map.cols}×{map.rows} squares · {map.feetPerSquare} ft each</div>
        </div>
        <Icon n="chevron" />
      </button>
      <button className="icon-btn" onClick={onInfo} aria-label="Map details"><Icon n="edit" /></button>
      <button className="icon-btn" onClick={onDelete} aria-label="Delete map"><Icon n="trash" /></button>
      {open && (
        <div className="menu" style={{ top: 54, left: 0 }}>
          {maps.map((m) => <button key={m.id} onClick={() => { onSwitch(m.id!); setOpen(false) }}><span className="grow">{m.name}</span>{m.id === map.id && <Icon n="check" s={18} />}</button>)}
          <hr />
          <button onClick={() => { setOpen(false); onNew() }}><Icon n="plus" s={18} />New map…</button>
        </div>
      )}
    </div>
  )
}

function NewMap({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, cols: number, rows: number, base: Terrain, feet: number) => void }) {
  const presets = [{ l: 'Small', c: 16, r: 12 }, { l: 'Medium', c: 24, r: 16 }, { l: 'Large', c: 36, r: 24 }, { l: 'Huge', c: 48, r: 32 }]
  const [name, setName] = useState('')
  const [p, setP] = useState(1)
  const [base, setBase] = useState('g')
  const [feet, setFeet] = useState('5')
  return (
    <FormModal title="New map" onClose={onClose} canSave={!!name.trim()} saveLabel="Create"
      onSave={() => onCreate(name.trim(), presets[p].c, presets[p].r, terrainByCode(base), Math.min(5280, Math.max(1, Number(feet) || 5)))}>
      <Field label="Name" value={name} onChange={setName} placeholder="e.g. Saltmere Harbor" autoFocus />
      <div className="stack"><Label>Size</Label>
        <Seg value={p} onChange={setP} options={presets.map((x, i) => ({ value: i, label: `${x.c}×${x.r}` }))} />
        <div className="muted tiny">{presets[p].l} grid</div>
      </div>
      <Select label="Starting terrain" value={base} onChange={setBase} options={TERRAINS.map((t) => ({ value: t.code, label: t.label }))} />
      <Field label="Feet per square" value={feet} onChange={(v) => setFeet(v.replace(/\D/g, ''))} placeholder="5 for battle maps, 100+ for towns" type="number" />
    </FormModal>
  )
}

function InfoDialog({ map, onClose }: { map: TileMapRow; onClose: () => void }) {
  const [name, setName] = useState(map.name)
  const [notes, setNotes] = useState(map.notes)
  const [feet, setFeet] = useState(String(map.feetPerSquare))
  return (
    <FormModal title="Map details" onClose={onClose} canSave={!!name.trim()} onSave={async () => {
      await save(db.tileMaps, { ...map, name: name.trim(), notes: notes.trim(), feetPerSquare: Math.min(5280, Math.max(1, Number(feet) || map.feetPerSquare)) }); onClose()
    }}>
      <Field label="Name" value={name} onChange={setName} />
      <Field label="Feet per square" value={feet} onChange={(v) => setFeet(v.replace(/\D/g, ''))} type="number" />
      <Field label="What this map is (helps Claude)" value={notes} onChange={setNotes} multi rows={3} placeholder="e.g. A storm-battered fishing village on a rocky coast" />
    </FormModal>
  )
}

function FeatureDialog({ f, map, onClose, onSave }: { f: FeatureRow; map: TileMapRow; onClose: () => void; onSave: (f: FeatureRow) => void }) {
  const [name, setName] = useState(f.name)
  const [icon, setIcon] = useState(f.icon)
  const [kind, setKind] = useState(f.kind)
  const [w, setW] = useState(f.w)
  const [h, setH] = useState(f.h)
  const [desc, setDesc] = useState(f.description)
  const maxW = Math.min(20, map.cols), maxH = Math.min(20, map.rows)
  return (
    <FormModal title={`Edit ${f.name}`} onClose={onClose} canSave={!!name.trim()} onSave={() => onSave({
      ...f, name: name.trim(), icon: icon.trim(), kind: kind.trim(), w, h, x: Math.min(f.x, map.cols - w), y: Math.min(f.y, map.rows - h), description: desc.trim(),
    })}>
      <div className="row">
        <div style={{ width: 84 }}><Field label="Icon" value={icon} onChange={(v) => setIcon(v.slice(0, 8))} /></div>
        <div className="grow"><Field label="Name" value={name} onChange={setName} /></div>
      </div>
      <Field label="Kind" value={kind} onChange={setKind} />
      <label className="field"><span>Width: {w} squares</span><input type="range" min={1} max={maxW} value={w} onChange={(e) => setW(Number(e.target.value))} /></label>
      <label className="field"><span>Height: {h} squares</span><input type="range" min={1} max={maxH} value={h} onChange={(e) => setH(Number(e.target.value))} /></label>
      <Field label="Description" value={desc} onChange={setDesc} multi rows={5} />
      <div className="muted tiny">At {cellName(f.x, f.y)}</div>
    </FormModal>
  )
}
