import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, remove, save, type IdeaRow } from '../lib/db'
import { ALL_TYPES, GENERATABLE, IDEA_TYPES, asType, type IdeaType } from '../lib/types'
import { useApp } from '../store'
import { Confirm, Empty, Field, FormModal, Header, Icon, Label, PillO, Select, TypeTag, typeOptions } from '../ui'
import type { TabId } from '../App'
import { setKept } from './keep'

type Filter = 'ALL' | 'OWN' | 'FAV' | 'UNUSED' | IdeaType

export default function Ideas({ go }: { go: (t: TabId) => void }) {
  const { campaignId, toast } = useApp()
  const ideas = useLiveQuery(() => db.ideas.where('campaignId').equals(campaignId).reverse().sortBy('createdAt'), [campaignId]) ?? []
  const [filter, setFilter] = useState<Filter>('ALL')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<IdeaRow | null>(null)
  const [deleting, setDeleting] = useState<IdeaRow | null>(null)

  const shown = ideas
    .filter((i) => filter === 'ALL' || (filter === 'OWN' ? i.isOwn : filter === 'FAV' ? i.favorite : filter === 'UNUSED' ? !i.used : i.type === filter))
    .filter((i) => !q || [i.title, i.body, i.tags].some((s) => s.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite))

  const filters: { v: Filter; l: string }[] = [
    { v: 'ALL', l: `All (${ideas.length})` }, { v: 'OWN', l: 'My own' }, { v: 'FAV', l: 'Favorites' }, { v: 'UNUSED', l: 'Not used yet' },
    ...ALL_TYPES.map((t) => ({ v: t as Filter, l: IDEA_TYPES[t].label })),
  ]

  const toOutline = async (i: IdeaRow) => {
    const beats = await db.beats.where('campaignId').equals(campaignId).sortBy('position')
    await save(db.beats, { campaignId, position: (beats[beats.length - 1]?.position ?? 0) + 1, act: beats[beats.length - 1]?.act ?? '', title: i.title, summary: i.body, status: 'PLANNED', uid: '', updatedAt: 0 })
    toast('Added to the outline')
  }
  const toMap = async (i: IdeaRow) => {
    const n = await db.nodes.where('campaignId').equals(campaignId).count()
    await save(db.nodes, { campaignId, label: i.title, note: i.body, kind: i.type, x: 120 + (n % 5) * 220, y: 120 + Math.floor(n / 5) * 160, ideaId: i.id!, uid: '', updatedAt: 0 })
    toast('Added to Concepts')
  }
  const toLoot = async (i: IdeaRow) => {
    const rarity = /Rarity:\s*([A-Za-z ]+)/i.exec(i.body)?.[1]?.trim() ?? 'Uncommon'
    await save(db.items, {
      campaignId, holderId: null, name: i.title, rarity: rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase(),
      requiresAttunement: /Attunement:\s*yes/i.test(i.body), attuned: false, charges: '', notes: i.body, acquiredAt: '', uid: '', updatedAt: 0,
    })
    toast('Added to the party stash')
  }

  return (
    <div className="scroll">
      <Header title="Ideas" sub="Everything saved from the Forge, plus your own">
        <button className="btn primary" onClick={() => setEditing({ campaignId, type: 'NOTE', title: '', body: '', tags: '', isOwn: true, favorite: false, used: false, createdAt: Date.now(), uid: '', updatedAt: 0 })}>
          <Icon n="plus" s={18} />Add my own
        </button>
      </Header>
      <div className="pad stack" style={{ paddingBottom: 10 }}>
        <div className="row" style={{ maxWidth: 520 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faded)' }}><Icon n="search" s={20} /></span>
            <input className="input" style={{ paddingLeft: 40 }} placeholder="Search ideas" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="chips scrollx">
          {filters.map((f) => <button key={f.v} className={`chip${filter === f.v ? ' on' : ''}`} onClick={() => setFilter(f.v)}>{f.l}</button>)}
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty icon="ideas" title={ideas.length ? 'Nothing matches' : 'No ideas yet'}
          body={ideas.length ? 'Try another filter or search.' : 'Save ideas from the Forge or jot down your own. They feed back into the generators so new ideas fit with them.'}>
          {!ideas.length && <button className="btn tonal" onClick={() => go('forge')}>Open the Forge</button>}
        </Empty>
      ) : (
        <div className="masonry pad">
          {shown.map((i) => (
            <div key={i.id} className="card click stack" onClick={() => setEditing(i)}>
              <div className="row" style={{ margin: '-6px -8px 0 0' }}>
                <TypeTag type={i.type} />
                {i.isOwn && <PillO text="Mine" color="var(--moss)" />}
                {i.used && <span title="Used" style={{ color: 'var(--moss)' }}><Icon n="check" s={16} /></span>}
                <div className="grow" />
                <button className={`icon-btn${i.favorite ? ' on' : ''}`} aria-label="Favorite" onClick={(e) => { e.stopPropagation(); void save(db.ideas, { ...i, favorite: !i.favorite }) }}>
                  <Icon n="star" fill={i.favorite} s={20} style={{ color: i.favorite ? IDEA_TYPES[asType(i.type)].color : undefined }} />
                </button>
              </div>
              <h3 className="title-s">{i.title}</h3>
              <div className="muted small" style={{ whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.body}</div>
            </div>
          ))}
        </div>
      )}
      {editing && <IdeaDialog idea={editing} onClose={() => setEditing(null)}
        onSave={async (i) => { await save(db.ideas, i); setEditing(null) }}
        onDelete={editing.id ? () => { setDeleting(editing); setEditing(null) } : undefined}
        actions={editing.id ? [
          ...(GENERATABLE.includes(asType(editing.type)) ? [{ l: 'Flesh out in Forge', i: 'forge', f: () => {
            setKept('forge.mode', 'own')
            setKept('forge.type', asType(editing.type))
            setKept('forge.own', { name: editing.title, notes: editing.body, versions: 1, ideaId: editing.id! })
            setKept(`forge.${campaignId}.${asType(editing.type)}.own`, { cards: [], kept: [], saved: [] })
            go('forge')
          } }] : []),
          { l: 'Outline', i: 'story', f: () => toOutline(editing) },
          { l: 'Concepts', i: 'concepts', f: () => toMap(editing) },
          ...(editing.type === 'MAGIC_ITEM' ? [{ l: 'Loot', i: 'loot', f: () => toLoot(editing) }] : []),
        ] : []} />}
      {deleting && <Confirm title="Delete idea?" body={`"${deleting.title}" will be gone for good.`} onConfirm={() => remove(db.ideas, deleting)} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function IdeaDialog({ idea, onClose, onSave, onDelete, actions }: {
  idea: IdeaRow; onClose: () => void; onSave: (i: IdeaRow) => void; onDelete?: () => void; actions: { l: string; i: string; f: () => void }[]
}) {
  const [type, setType] = useState(asType(idea.type))
  const [title, setTitle] = useState(idea.title)
  const [body, setBody] = useState(idea.body)
  const [tags, setTags] = useState(idea.tags)
  const [used, setUsed] = useState(idea.used)
  return (
    <FormModal title={idea.id ? 'Edit idea' : 'My own idea'} onClose={onClose} canSave={!!title.trim()}
      onSave={() => onSave({ ...idea, type, title: title.trim(), body: body.trim(), tags: tags.trim(), used })}
      left={onDelete && <button className="btn danger" onClick={onDelete}>Delete</button>}>
      <Select label="Type" value={type} onChange={setType} options={typeOptions(ALL_TYPES)} />
      <Field label="Title" value={title} onChange={setTitle} autoFocus={!idea.id} />
      <Field label="Details" value={body} onChange={setBody} multi rows={7} placeholder={'Use "Label: text" lines if you like, e.g.\nWants: revenge'} />
      <Field label="Tags (comma separated)" value={tags} onChange={setTags} />
      <label className="check"><input type="checkbox" checked={used} onChange={(e) => setUsed(e.target.checked)} />Already used in a session</label>
      {actions.length > 0 && (
        <div className="stack">
          <Label>Send to</Label>
          <div className="chips">
            {actions.map((a) => <button key={a.l} className="chip" onClick={() => { a.f(); onClose() }}><Icon n={a.i} s={16} />{a.l}</button>)}
          </div>
        </div>
      )}
    </FormModal>
  )
}
