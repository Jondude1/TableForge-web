import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, remove, save, type TableRow } from '../lib/db'
import { tableEntries } from '../lib/forge'
import { friendly } from '../lib/ai'
import { useAi } from '../lib/settings'
import { DICE } from '../lib/types'
import { defaultCount, entriesFor, lookup, rangeLabel, ranges, roll } from '../lib/tablemath'
import { useApp } from '../store'
import { Confirm, Die, Empty, Field, Header, Icon, Label, useWide } from '../ui'
import { useKept } from './keep'

interface Rolled { label: string; n: number; sides: number; text?: string; at: number }
interface Draft { original: TableRow | null; name: string; sides: number; description: string; shared: boolean; entries: string[] }

export default function Tables() {
  const { campaignId, buildCtx, toast } = useApp()
  const ai = useAi()
  const wide = useWide()
  const tables = useLiveQuery(() => db.rollTables.filter((t) => t.campaignId === campaignId || t.campaignId == null).toArray(), [campaignId]) ?? []
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name))
  const [selected, setSelected] = useKept<number | null>('tables.sel', null)
  const [log, setLog] = useKept<Rolled[]>('tables.log', [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<TableRow | null>(null)
  const sel = sorted.find((t) => t.id === selected) ?? null

  useEffect(() => { if (wide && selected == null && sorted.length) setSelected(sorted[0].id!) }, [wide, selected, sorted, setSelected])

  const doRoll = (label: string, sides: number, text?: string, n = roll(sides)): Rolled => {
    const r = { label, n, sides, text, at: Date.now() }
    setLog([r, ...log].slice(0, 50))
    return r
  }

  const generateInto = async (d: Draft) => {
    setBusy(true)
    try {
      const count = d.entries.length ? Math.min(d.entries.length, d.sides) : defaultCount(d.sides)
      const texts = await tableEntries(ai, await buildCtx(), d.name, d.description, count)
      setDraft({ ...d, entries: texts })
    } catch (e) { toast(friendly(e)) } finally { setBusy(false) }
  }

  const saveDraft = async (d: Draft) => {
    const base = d.original ?? { name: '', dieSides: 12, description: '', campaignId: null, createdAt: Date.now(), uid: '', updatedAt: 0 }
    const id = await save(db.rollTables, { ...base, name: d.name.trim(), dieSides: d.sides, description: d.description.trim(), campaignId: d.shared ? null : campaignId })
    await db.transaction('rw', db.entries, async () => {
      await db.entries.where('tableId').equals(id).delete()
      await db.entries.bulkAdd(entriesFor(id, d.sides, d.entries.map((e) => e.trim()).filter(Boolean)))
    })
    setSelected(id); setDraft(null)
  }

  const newDraft = () => { setDraft({ original: null, name: '', sides: 12, description: '', shared: false, entries: Array(12).fill('') }); setSelected(null) }

  const list = (
    <div>
      <Header title="Tables" sub="Roll on your own d4–d100 tables"><button className="btn primary" onClick={newDraft}><Icon n="plus" s={18} />Table</button></Header>
      <div className="pad stack">
        <DiceTray onRoll={(s) => doRoll(`d${s}`, s)} />
        <Label style={{ marginTop: 6 }}>Your tables</Label>
        {sorted.map((t) => (
          <button key={t.id} className="card click row" style={{ textAlign: 'left', padding: 12, gap: 12, background: t.id === selected && !draft ? 'rgba(92,70,32,.45)' : 'var(--hearth)', borderColor: t.id === selected && !draft ? 'rgba(212,168,75,.55)' : undefined }}
            onClick={() => { setSelected(t.id!); setDraft(null) }}>
            <Die label={String(t.dieSides)} size={40} />
            <div className="grow">
              <div className="title-s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              {t.description && <div className="muted tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>}
            </div>
            {t.campaignId == null && <span className="muted tiny" title="Shared with all campaigns">all</span>}
          </button>
        ))}
        {!sorted.length && <div className="muted small">No tables yet. Make one — rumors, loot, weather, wild magic…</div>}
        {log.length > 0 && (
          <>
            <div className="row" style={{ marginTop: 10 }}><Label style={{ flex: 1 }}>Roll log</Label><button className="btn ghost sm" onClick={() => setLog([])}>Clear</button></div>
            {log.slice(0, 12).map((r) => (
              <div key={r.at} className="row" style={{ alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--gold)', width: 40 }}>{r.n}</span>
                <div className="grow"><div className="muted tiny">{r.label}</div>{r.text && <div className="small">{r.text}</div>}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )

  const detail = draft
    ? <Editor d={draft} set={setDraft} busy={busy} onGenerate={() => generateInto(draft)} onCancel={() => setDraft(null)} onSave={() => saveDraft(draft)} />
    : sel
      ? <Detail t={sel} back={!wide ? () => setSelected(null) : undefined} onRoll={(entries) => {
          const n = roll(sel.dieSides)
          return doRoll(sel.name, sel.dieSides, lookup(entries, n)?.text ?? `(no entry for ${n})`, n)
        }}
        onEdit={async () => {
          const es = await db.entries.where('tableId').equals(sel.id!).sortBy('minRoll')
          setDraft({ original: sel, name: sel.name, sides: sel.dieSides, description: sel.description, shared: sel.campaignId == null, entries: es.map((e) => e.text) })
        }}
        onDelete={() => setDeleting(sel)} />
      : <Empty icon="tables" title="Pick a table" body="Choose a table to roll on, or make a new one." />

  return (
    <>
      {wide ? (
        <div className="split"><div className="side">{list}</div><div className="body">{detail}</div></div>
      ) : (
        <div className="scroll">{draft || sel ? detail : list}</div>
      )}
      {deleting && <Confirm title={`Delete "${deleting.name}"?`} body="The table and all its entries will be removed."
        onConfirm={async () => { await db.entries.where('tableId').equals(deleting.id!).delete(); await remove(db.rollTables, deleting, campaignId); setSelected(null) }}
        onClose={() => setDeleting(null)} />}
    </>
  )
}

function DiceTray({ onRoll }: { onRoll: (sides: number) => Rolled }) {
  const [last, setLast] = useState<Rolled | null>(null)
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <Label style={{ flex: 1 }}>Quick roll</Label>
        {last && <span className="small muted">d{last.sides} → <b style={{ fontFamily: 'var(--display)', color: 'var(--gold)', fontSize: 22 }}>{last.n}</b></span>}
      </div>
      <div className="chips" style={{ gap: 6 }}>
        {DICE.map((s) => <Die key={s} label={`d${s}`} size={44} onClick={() => setLast(onRoll(s))} />)}
      </div>
    </div>
  )
}

function Detail({ t, back, onRoll, onEdit, onDelete }: {
  t: TableRow; back?: () => void; onRoll: (e: { minRoll: number; maxRoll: number; text: string }[]) => Rolled; onEdit: () => void; onDelete: () => void
}) {
  const entries = useLiveQuery(() => db.entries.where('tableId').equals(t.id!).sortBy('minRoll'), [t.id]) ?? []
  const [res, setRes] = useState<Rolled | null>(null)
  const [spin, setSpin] = useState(0)
  useEffect(() => { setRes(null) }, [t.id])
  return (
    <div className="pad" style={{ paddingTop: 16 }}>
      <div className="row">
        {back && <button className="icon-btn" onClick={back} aria-label="Back"><Icon n="back" /></button>}
        <div className="grow">
          <h2 className="h2">{t.name}</h2>
          <div className="muted small">d{t.dieSides} · {entries.length} entries{t.campaignId == null ? ' · all campaigns' : ''}</div>
        </div>
        <button className="icon-btn" onClick={onEdit} aria-label="Edit table"><Icon n="edit" /></button>
        <button className="icon-btn" onClick={onDelete} aria-label="Delete table"><Icon n="trash" /></button>
      </div>
      {t.description && <p className="muted" style={{ margin: '8px 0 0' }}>{t.description}</p>}
      <div className="row" style={{ gap: 18, padding: '20px 0' }}>
        <Die label={res ? String(res.n) : `d${t.dieSides}`} size={96} filled={!!res} spin={spin} onClick={() => { setRes(onRoll(entries)); setSpin(spin + 1) }} />
        <div className="grow">
          {!res ? (
            <>
              <div className="title-s muted">Tap the die to roll</div>
              {!entries.length && <div className="muted small">This table has no entries yet — tap edit to add some.</div>}
            </>
          ) : (
            <><div className="label">Rolled {res.n}</div><div className="title" style={{ marginTop: 4 }}>{res.text}</div></>
          )}
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--seam-soft)', paddingTop: 6 }}>
        {entries.map((e) => {
          const hit = res && res.n >= e.minRoll && res.n <= e.maxRoll
          return <div key={e.id} className={`entry${hit ? ' hit' : ''}`}><span className="rng">{rangeLabel(e.minRoll, e.maxRoll, t.dieSides)}</span><span className="grow">{e.text}</span></div>
        })}
      </div>
    </div>
  )
}

function Editor({ d, set, busy, onGenerate, onCancel, onSave }: { d: Draft; set: (d: Draft) => void; busy: boolean; onGenerate: () => void; onCancel: () => void; onSave: () => void }) {
  const rs = ranges(d.sides, d.entries.length)
  return (
    <div className="pad stack-l" style={{ paddingTop: 16 }}>
      <div className="row">
        <button className="icon-btn hide-wide" onClick={onCancel} aria-label="Back"><Icon n="back" /></button>
        <h2 className="h2 grow">{d.original ? 'Edit table' : 'New table'}</h2>
        <button className="btn ghost hide-narrow" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!d.name.trim() || busy} onClick={onSave}>Save</button>
      </div>
      <Field label="Table name" value={d.name} onChange={(name) => set({ ...d, name })} placeholder="e.g. Things found in a goblin's pocket" autoFocus={!d.original} />
      <Field label="What it's for (helps generation)" value={d.description} onChange={(description) => set({ ...d, description })} multi rows={2} />
      <div className="stack">
        <Label>Die</Label>
        <div className="chips" style={{ gap: 6 }}>
          {DICE.map((s) => <Die key={s} label={`d${s}`} size={48} filled={d.sides === s} onClick={() => {
            const blank = d.entries.every((e) => !e.trim())
            set({ ...d, sides: s, entries: blank ? Array(defaultCount(s)).fill('') : d.entries })
          }} />)}
        </div>
      </div>
      <div className="row">
        <Label style={{ flex: 1 }}>Entries · {d.entries.length}</Label>
        <button className="btn outline sm" disabled={busy || !d.name.trim()} onClick={onGenerate}>{busy ? <span className="spinner" /> : <Icon n="forge" s={16} />}Generate entries</button>
      </div>
      {!d.name.trim() && <div className="muted tiny" style={{ marginTop: -8 }}>Name the table first so generation knows what to write.</div>}
      {d.entries.length > d.sides && <div className="err tiny">A d{d.sides} only has {d.sides} results — extra entries won't be rollable.</div>}
      <div className="stack">
        {d.entries.map((e, i) => (
          <div key={i} className="row">
            <span style={{ width: 54, textAlign: 'right', fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--gold)', fontSize: 14 }}>{rs[i] ? rangeLabel(rs[i][0], rs[i][1], d.sides) : '—'}</span>
            <input className="input grow" value={e} placeholder={`Entry ${i + 1}`} onChange={(ev) => set({ ...d, entries: d.entries.map((x, j) => (j === i ? ev.target.value : x)) })} />
            <button className="icon-btn" onClick={() => set({ ...d, entries: d.entries.filter((_, j) => j !== i) })} aria-label="Remove entry"><Icon n="close" /></button>
          </div>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn ghost" disabled={d.entries.length >= d.sides} onClick={() => set({ ...d, entries: [...d.entries, ''] })}><Icon n="plus" s={18} />Add entry</button>
        <div className="grow" />
        <label className="check"><input type="checkbox" checked={d.shared} onChange={(e) => set({ ...d, shared: e.target.checked })} />Use in all campaigns</label>
      </div>
    </div>
  )
}
