import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, remove, save, type EdgeRow, type NodeRow } from '../lib/db'
import { ALL_TYPES, IDEA_TYPES, asType } from '../lib/types'
import { useApp } from '../store'
import { Empty, Field, FormModal, Icon, LabeledBody, Modal, Select, TypeTag, typeOptions, useWide } from '../ui'
import { useView } from './board'

const NW = 180, NH = 64

export default function Concepts() {
  const { campaignId, toast } = useApp()
  const wide = useWide()
  const nodes = useLiveQuery(() => db.nodes.where('campaignId').equals(campaignId).toArray(), [campaignId]) ?? []
  const edges = useLiveQuery(() => db.edges.where('campaignId').equals(campaignId).toArray(), [campaignId]) ?? []
  const ideas = useLiveQuery(() => db.ideas.where('campaignId').equals(campaignId).toArray(), [campaignId]) ?? []
  const { view, setView, zoomAt, toContent, down, move, up, panBy } = useView({ scale: 1, x: 24, y: 24 }, 0.3, 2.5)
  const [sel, setSel] = useState<number | null>(null)
  const [linking, setLinking] = useState<number | null>(null)
  const [live, setLive] = useState<Record<number, { x: number; y: number }>>({})
  const [adding, setAdding] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<NodeRow | null>(null)
  const [picking, setPicking] = useState(false)
  const [edgeEdit, setEdgeEdit] = useState<EdgeRow | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const g = useRef<{ id: number; mode: 'node' | 'pan'; node?: NodeRow; sx: number; sy: number; lx: number; ly: number; moved: boolean } | null>(null)
  const lastTap = useRef<{ key: string; t: number }>({ key: '', t: 0 })

  const selected = nodes.find((n) => n.id === sel) ?? null
  const pos = (n: NodeRow) => live[n.id!] ?? { x: n.x, y: n.y }
  const rel = (e: React.PointerEvent | React.WheelEvent) => {
    const r = boardRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e: React.PointerEvent) => {
    const p = rel(e)
    boardRef.current?.setPointerCapture(e.pointerId)
    if (down(e.pointerId, p.x, p.y)) { g.current = null; return }
    const el = (e.target as HTMLElement).closest('[data-node]') as HTMLElement | null
    const node = el ? nodes.find((n) => n.id === Number(el.dataset.node)) : undefined
    g.current = { id: e.pointerId, mode: node ? 'node' : 'pan', node, sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const p = rel(e)
    if (move(e.pointerId, p.x, p.y)) return
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    if (!s.moved && Math.hypot(p.x - s.sx, p.y - s.sy) > 6) s.moved = true
    if (!s.moved) return
    if (s.mode === 'pan') panBy(p.x - s.lx, p.y - s.ly)
    else if (s.node) {
      const start = { x: s.node.x, y: s.node.y }
      setLive((l) => ({ ...l, [s.node!.id!]: { x: Math.round(start.x + (p.x - s.sx) / view.scale), y: Math.round(start.y + (p.y - s.sy) / view.scale) } }))
    }
    s.lx = p.x; s.ly = p.y
  }
  const onUp = (e: React.PointerEvent) => {
    up(e.pointerId)
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    g.current = null
    if (s.moved) {
      if (s.node && live[s.node.id!]) {
        const to = live[s.node.id!]
        void save(db.nodes, { ...s.node, x: to.x, y: to.y }).then(() => setLive((l) => { const c = { ...l }; delete c[s.node!.id!]; return c }))
      }
      return
    }
    // A tap.
    const key = s.node ? `n${s.node.id}` : 'bg'
    const dbl = lastTap.current.key === key && Date.now() - lastTap.current.t < 320
    lastTap.current = { key, t: Date.now() }
    if (s.node) {
      if (linking != null && linking !== s.node.id) { void connect(linking, s.node.id!); setLinking(null); setSel(s.node.id!); return }
      setSel(s.node.id!)
      if (dbl) setEditing(s.node)
    } else {
      setSel(null); setLinking(null)
      if (dbl) { const c = toContent(s.sx, s.sy); setAdding({ x: Math.round(c.x - NW / 2), y: Math.round(c.y - NH / 2) }) }
    }
  }

  const connect = async (a: number, b: number) => {
    if (edges.some((e) => (e.fromId === a && e.toId === b) || (e.fromId === b && e.toId === a))) { toast('Those are already linked'); return }
    await save(db.edges, { campaignId, fromId: a, toId: b, label: '', uid: '', updatedAt: 0 })
  }

  const deleteNode = async (n: NodeRow) => {
    for (const e of edges.filter((e) => e.fromId === n.id || e.toId === n.id)) await remove(db.edges, e)
    await remove(db.nodes, n); setSel(null)
  }

  /** The nearest open, fully visible spot to the middle of the view, so new concepts never overlap. */
  const centerSpot = () => {
    const r = boardRef.current?.getBoundingClientRect()
    const w = r?.width ?? 400, h = r?.height ?? 300
    const c = toContent(w / 2, h / 2), tl = toContent(12, 12), br = toContent(w - 12, h - 70)
    const free = (x: number, y: number) => nodes.every((n) => Math.abs(n.x - x) > NW + 16 || Math.abs(n.y - y) > NH + 20)
    const ox = Math.round(c.x - NW / 2), oy = Math.round(c.y - NH / 2)
    const spots: { x: number; y: number; d: number; vis: boolean }[] = []
    for (let dy = -6; dy <= 6; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = ox + dx * (NW + 24), y = oy + dy * (NH + 28)
      spots.push({ x, y, d: Math.hypot(dx * 1.6, dy), vis: x >= tl.x && y >= tl.y && x + NW <= br.x && y + NH <= br.y })
    }
    spots.sort((a, b) => Number(b.vis) - Number(a.vis) || a.d - b.d)
    return spots.find((p) => free(p.x, p.y)) ?? { x: ox, y: oy }
  }

  const board = (
    <div ref={boardRef} className="board dots" style={{ backgroundSize: `${32 * view.scale}px ${32 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onWheel={(e) => { const p = rel(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1) }}>
      <div className="layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width="1" height="1">
          {edges.map((e) => {
            const a = nodes.find((n) => n.id === e.fromId), b = nodes.find((n) => n.id === e.toId)
            if (!a || !b) return null
            const pa = pos(a), pb = pos(b)
            const hot = sel === a.id || sel === b.id
            return (
              <g key={e.id}>
                <line x1={pa.x + NW / 2} y1={pa.y + NH / 2} x2={pb.x + NW / 2} y2={pb.y + NH / 2} stroke={hot ? '#F0C766' : 'rgba(212,168,75,.45)'} strokeWidth={hot ? 3 : 2} strokeDasharray={e.label ? '10 6' : undefined} />
                {e.label && <text x={(pa.x + pb.x) / 2 + NW / 2} y={(pa.y + pb.y) / 2 + NH / 2 - 6} textAnchor="middle" fill="#D4A84B" fontSize="13" fontFamily="Crimson Text, serif" stroke="#17110C" strokeWidth="4" paintOrder="stroke">{e.label}</text>}
              </g>
            )
          })}
        </svg>
        {nodes.map((n) => {
          const p = pos(n), t = IDEA_TYPES[asType(n.kind)]
          const on = n.id === sel
          return (
            <div key={n.id} data-node={n.id} className={`node${on ? ' sel' : ''}`} style={{ left: p.x, top: p.y, borderColor: on ? 'var(--gold)' : linking != null && linking !== n.id ? 'rgba(212,168,75,.7)' : `${t.color}8c` }}>
              <div className="stripe" style={{ background: t.color }} />
              <div className="nb">
                <div className="label" style={{ color: t.color, fontSize: 10 }}>{t.singular}</div>
                <div className="title-s" style={{ fontSize: 17, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.label}</div>
              </div>
            </div>
          )
        })}
      </div>
      {nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0 }} onPointerDown={(e) => e.stopPropagation()}>
          <Empty icon="concepts" title="Map out your ideas" body="Double-tap anywhere to add a concept, drag to arrange, and link related ideas — factions, NPCs, secrets, places.">
            <div className="row">
              <button className="btn primary" onClick={() => setAdding(centerSpot())}>Add a concept</button>
              <button className="btn outline" disabled={!ideas.length} onClick={() => setPicking(true)}>From Ideas</button>
            </div>
          </Empty>
        </div>
      )}
      {linking != null && (
        <div className="row" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'var(--gold-dim)', color: '#FFE3A6', borderRadius: 99, padding: '4px 4px 4px 16px' }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="small">Tap another concept to link it</span>
          <button className="icon-btn" style={{ color: 'inherit' }} onClick={() => setLinking(null)} aria-label="Cancel linking"><Icon n="close" /></button>
        </div>
      )}
      {nodes.length > 0 && <div className="hint"><Icon n="touch" s={15} />Double-tap to add · drag to move · pinch to zoom</div>}
      {nodes.length > 0 && (
        <div className="fab row" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn" style={{ background: 'var(--leather-hi)' }} onClick={() => setView({ scale: 1, x: 24, y: 24 })} aria-label="Reset view"><Icon n="fit" /></button>
          <button className="btn primary" onClick={() => setAdding(centerSpot())}><Icon n="plus" s={18} />Concept</button>
        </div>
      )}
    </div>
  )

  const panel = (
    <div className="stack" style={{ padding: wide ? 20 : 14 }}>
      {wide && <><h1 className="h1">Concepts</h1><div className="rule" /></>}
      <div className="row">
        <div className="muted small grow">{nodes.length} concept{nodes.length === 1 ? '' : 's'} · {edges.length} link{edges.length === 1 ? '' : 's'}</div>
        <button className="btn outline sm" disabled={!ideas.length} onClick={() => setPicking(true)}><Icon n="ideas" s={16} />From Ideas</button>
      </div>
      {!selected ? (
        <div className="muted small">Tap a concept to see it here. Double-tap to edit; use "Link to…" to connect two.</div>
      ) : (
        <div className="card stack">
          <TypeTag type={selected.kind} />
          <h3 className="title">{selected.label}</h3>
          {selected.note && <LabeledBody body={selected.note} />}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn tonal sm" onClick={() => setLinking(selected.id!)}><Icon n="link" s={16} />Link to…</button>
            <button className="btn ghost sm" onClick={() => setEditing(selected)}>Edit</button>
            <div className="grow" />
            <button className="icon-btn" style={{ color: 'var(--error)' }} onClick={() => deleteNode(selected)} aria-label="Delete concept"><Icon n="trash" /></button>
          </div>
          {edges.filter((e) => e.fromId === selected.id || e.toId === selected.id).map((e) => {
            const other = nodes.find((n) => n.id === (e.fromId === selected.id ? e.toId : e.fromId))
            if (!other) return null
            return (
              <div key={e.id} className="row" style={{ cursor: 'pointer' }} onClick={() => setEdgeEdit(e)}>
                <Icon n="link" s={16} style={{ color: 'var(--gold)' }} />
                <div className="grow"><div className="small">{other.label}</div><div className="muted tiny">{e.label || 'Tap to describe the link'}</div></div>
                <button className="icon-btn" onClick={(ev) => { ev.stopPropagation(); void remove(db.edges, e) }} aria-label="Remove link"><Icon n="close" s={18} /></button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <>
      {wide ? (
        <div className="split"><div className="body" style={{ overflow: 'hidden' }}>{board}</div><div className="side right" style={{ width: 340 }}>{panel}</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: 1.5, minHeight: 0 }}>{board}</div>
          <div className="panel" style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: '1px solid var(--seam-soft)' }}>{panel}</div>
        </div>
      )}
      {adding && <NodeDialog onClose={() => setAdding(null)} onSave={async (label, note, kind) => {
        await save(db.nodes, { campaignId, label, note, kind, x: adding.x, y: adding.y, ideaId: null, uid: '', updatedAt: 0 }); setAdding(null)
      }} />}
      {editing && <NodeDialog node={editing} onClose={() => setEditing(null)} onSave={async (label, note, kind) => { await save(db.nodes, { ...editing, label, note, kind }); setEditing(null) }} />}
      {edgeEdit && <EdgeDialog edge={edgeEdit} onClose={() => setEdgeEdit(null)} />}
      {picking && (
        <Modal title="Add from Ideas" onClose={() => setPicking(false)} footer={<button className="btn ghost" onClick={() => setPicking(false)}>Done</button>}>
          {ideas.map((i) => {
            const on = nodes.some((n) => n.ideaId === i.id)
            return (
              <button key={i.id} className="row" disabled={on} style={{ background: 'none', border: 0, padding: '8px 0', textAlign: 'left', opacity: on ? 0.5 : 1 }}
                onClick={async () => {
                  const c = centerSpot()
                  await save(db.nodes, { campaignId, label: i.title, note: i.body, kind: i.type, x: c.x, y: c.y, ideaId: i.id!, uid: '', updatedAt: 0 })
                  setPicking(false)
                }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: IDEA_TYPES[asType(i.type)].color, flex: 'none' }} />
                <span className="grow">{i.title}</span>{on && <span className="muted tiny">on map</span>}
              </button>
            )
          })}
        </Modal>
      )}
    </>
  )
}

function NodeDialog({ node, onClose, onSave }: { node?: NodeRow; onClose: () => void; onSave: (label: string, note: string, kind: string) => void }) {
  const [label, setLabel] = useState(node?.label ?? '')
  const [note, setNote] = useState(node?.note ?? '')
  const [kind, setKind] = useState(asType(node?.kind ?? 'NOTE'))
  return (
    <FormModal title={node ? 'Edit concept' : 'New concept'} onClose={onClose} canSave={!!label.trim()} onSave={() => onSave(label.trim(), note.trim(), kind)}>
      <Field label="Name" value={label} onChange={setLabel} placeholder="e.g. The Ashen Court" autoFocus />
      <Select label="Kind" value={kind} onChange={setKind} options={typeOptions(ALL_TYPES)} />
      <Field label="Notes" value={note} onChange={setNote} multi rows={4} />
    </FormModal>
  )
}

function EdgeDialog({ edge, onClose }: { edge: EdgeRow; onClose: () => void }) {
  const [label, setLabel] = useState(edge.label)
  return (
    <FormModal title="Describe the link" onClose={onClose} onSave={async () => { await save(db.edges, { ...edge, label: label.trim() }); onClose() }}>
      <Field label="How are they connected?" value={label} onChange={setLabel} placeholder="e.g. secretly funds, rivals, owes a debt to" autoFocus />
    </FormModal>
  )
}
