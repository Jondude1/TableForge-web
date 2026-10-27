import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, remove, save, type BeatRow, type CampaignRow } from '../lib/db'
import { fillGap, nextBeats, type Card } from '../lib/forge'
import { friendly } from '../lib/ai'
import { useAi } from '../lib/settings'
import { BEAT_STATUS, type BeatStatus } from '../lib/types'
import { useApp } from '../store'
import { Confirm, Empty, ErrorBanner, Field, FormModal, Header, Icon, Label, PillO, Select, Seg, useWide } from '../ui'
import { IdeaCard } from './Forge'
import { useKept } from './keep'

interface Anchor { before: string | null; after: string | null }

export default function Story() {
  const { campaignId, campaign, buildCtx, toast } = useApp()
  const ai = useAi()
  const wide = useWide()
  const beats = useLiveQuery(() => db.beats.where('campaignId').equals(campaignId).sortBy('position'), [campaignId]) ?? []
  const [steer, setSteer] = useKept('story.steer', '')
  const [cards, setCards] = useKept<Card[]>(`story.${campaignId}.cards`, [])
  const [saved, setSaved] = useKept<string[]>(`story.${campaignId}.saved`, [])
  const [anchor, setAnchor] = useKept<Anchor | null>(`story.${campaignId}.anchor`, null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BeatRow | null>(null)
  const [editingPlot, setEditingPlot] = useState(false)
  const [deleting, setDeleting] = useState<BeatRow | null>(null)
  const [pane, setPane] = useState<'outline' | 'ideas'>('outline')

  const ask = async (a: Anchor | null) => {
    const ctx = await buildCtx()
    if (!ctx) return
    setAnchor(a); setCards([]); setLoading(true); setError(null); setPane('ideas')
    try {
      const before = a?.before ? beats.find((b) => b.uid === a.before) ?? null : null
      const after = a?.after ? beats.find((b) => b.uid === a.after) ?? null : null
      setCards(a ? await fillGap(ai, ctx, before, after, steer) : await nextBeats(ai, ctx, steer))
    } catch (e) { setError(friendly(e)) } finally { setLoading(false) }
  }

  const accept = async (c: Card) => {
    const maxPos = beats.reduce((m, b) => Math.max(m, b.position), 0)
    const before = anchor?.before ? beats.find((b) => b.uid === anchor.before) : undefined
    const after = anchor?.after ? beats.find((b) => b.uid === anchor.after) : undefined
    const position = !anchor ? maxPos + 1 : before && after ? (before.position + after.position) / 2 : after ? after.position - 1 : before ? before.position + 1 : maxPos + 1
    await save(db.beats, { campaignId, position, act: before?.act ?? beats[beats.length - 1]?.act ?? '', title: c.title, summary: c.body, status: 'PLANNED', uid: '', updatedAt: 0 })
    setCards(cards.filter((x) => x.key !== c.key))
    toast('Added to the outline')
  }

  const move = async (b: BeatRow, up: boolean) => {
    const i = beats.findIndex((x) => x.id === b.id), j = up ? i - 1 : i + 1
    if (j < 0 || j >= beats.length) return
    const o = beats[j]
    await save(db.beats, { ...b, position: o.position })
    await save(db.beats, { ...o, position: b.position })
  }

  const outline = (
    <div className="pad" style={{ paddingTop: 0 }}>
      <div className="card click stack" style={{ borderColor: 'rgba(212,168,75,.35)' }} onClick={() => setEditingPlot(true)}>
        <div className="row"><Label>Overall plot</Label><div className="grow" /><Icon n="edit" s={18} style={{ color: 'var(--faded)' }} /></div>
        <div className={campaign.premise ? '' : 'muted'} style={{ fontSize: 18, whiteSpace: 'pre-wrap' }}>
          {campaign.premise || 'Tap to write the big picture: who the villain is, what they want, and how it ends if the party does nothing.'}
        </div>
        {(campaign.setting || campaign.tone) && <div className="chips">
          {campaign.setting && <PillO text={campaign.setting.slice(0, 40)} color="var(--moss)" />}
          {campaign.tone && <PillO text={campaign.tone.slice(0, 40)} color="var(--gold)" />}
        </div>}
      </div>
      <div className="row" style={{ margin: '20px 0 4px' }}>
        <Label style={{ flex: 1 }}>Outline · {beats.length} beat{beats.length === 1 ? '' : 's'}</Label>
        <button className="btn ghost sm" onClick={() => ask(null)}><Icon n="forge" s={18} />Suggest next</button>
      </div>
      {beats.length === 0 && (
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: '20px 0' }}>
          <div className="title-s">No beats yet.</div>
          <div className="muted small">Add the big moments you already know, then tap "Fill gap" to get ideas for what goes between them.</div>
          <button className="btn tonal" onClick={() => ask({ before: null, after: null })}>Suggest an opening</button>
        </div>
      )}
      {beats.map((b, i) => {
        const prev = beats[i - 1]
        const newAct = b.act && (i === 0 || prev.act !== b.act)
        const gapOn = anchor?.before === (prev?.uid ?? null) && anchor?.after === b.uid
        return (
          <div key={b.id}>
            {newAct && <div className="h2" style={{ color: 'var(--gold)', fontSize: 17, margin: '16px 0 2px' }}>{b.act}</div>}
            <button className={`gap${gapOn ? ' on' : ''}`} onClick={() => ask({ before: prev?.uid ?? null, after: b.uid })}>
              <Icon n="forge" s={13} />{prev ? 'Fill gap' : 'Fill gap before'}
            </button>
            <BeatRow n={i + 1} b={b} first={i === 0} last={i === beats.length - 1}
              onOpen={() => setEditing(b)} onDelete={() => setDeleting(b)} onMove={(up) => move(b, up)}
              onStatus={() => {
                const order: BeatStatus[] = ['PLANNED', 'IN_PLAY', 'DONE']
                void save(db.beats, { ...b, status: order[(order.indexOf(b.status as BeatStatus) + 1) % 3] })
              }} />
            {i === beats.length - 1 && (
              <button className={`gap${anchor?.before === b.uid && anchor?.after === null ? ' on' : ''}`} onClick={() => ask({ before: b.uid, after: null })}>
                <Icon n="forge" s={13} />What comes after?
              </button>
            )}
          </div>
        )
      })}
    </div>
  )

  const suggestions = (
    <div className="stack" style={{ padding: wide ? 20 : '0 14px 24px' }}>
      {wide && <h2 className="h2">Suggestions</h2>}
      <div className="muted small">
        {!anchor ? 'Next-beat ideas based on where the story is now.' : !anchor.before && !anchor.after ? 'Ways the campaign could open.' : 'Options for the gap you picked. Add one and it slots right in.'}
      </div>
      <textarea className="textarea" rows={2} value={steer} onChange={(e) => setSteer(e.target.value)} placeholder="Steer the ideas, e.g. the rival should betray them" />
      {loading && <div className="progress" />}
      {error && <ErrorBanner msg={error} />}
      {!cards.length && !loading && <Empty icon="story" title="Need a nudge?" body='Tap "Suggest next" or a "Fill gap" marker in the outline.' />}
      {cards.map((c) => (
        <IdeaCard key={c.key} card={c} type="STORY_BEAT" kept={false} saved={saved.includes(c.key)} busy={loading}
          onDiscard={() => setCards(cards.filter((x) => x.key !== c.key))}
          onSave={async () => {
            await save(db.ideas, { campaignId, type: 'STORY_BEAT', title: c.title, body: c.body, tags: c.tags, isOwn: false, favorite: false, used: false, createdAt: Date.now(), uid: '', updatedAt: 0 })
            setSaved([...saved, c.key]); toast('Saved to Ideas')
          }}
          extra={<button className="btn primary sm" onClick={() => accept(c)}><Icon n="plus" s={16} />Add</button>} />
      ))}
      {cards.length > 0 && (
        <div className="row">
          <button className="btn outline" disabled={loading} onClick={() => ask(anchor)}><Icon n="refresh" s={18} />Regenerate</button>
          <button className="btn ghost" onClick={() => { setCards([]); setAnchor(null) }}>Clear</button>
        </div>
      )}
    </div>
  )

  const addBeat = () => setEditing({ campaignId, position: 0, act: beats[beats.length - 1]?.act ?? 'Act 1', title: '', summary: '', status: 'PLANNED', uid: '', updatedAt: 0 })

  return (
    <>
      {wide ? (
        <div className="split">
          <div className="body">
            <Header title="Story" sub="The overall plot and the beats that get you there">
              <button className="btn outline" onClick={addBeat}><Icon n="plus" s={18} />Beat</button>
            </Header>
            {outline}
          </div>
          <div className="side right" style={{ width: 420 }}>{suggestions}</div>
        </div>
      ) : (
        <div className="scroll">
          <Header title="Story"><button className="btn outline sm" onClick={addBeat}><Icon n="plus" s={16} />Beat</button></Header>
          <div style={{ padding: '0 14px 12px' }}>
            <Seg value={pane} onChange={setPane} options={[{ value: 'outline', label: 'Outline' }, { value: 'ideas', label: `Suggestions${cards.length ? ` (${cards.length})` : ''}` }]} />
          </div>
          {pane === 'outline' ? outline : suggestions}
        </div>
      )}
      {editing && <BeatDialog beat={editing} onClose={() => setEditing(null)} onSave={async (b) => {
        const pos = b.id ? b.position : beats.reduce((m, x) => Math.max(m, x.position), 0) + 1
        await save(db.beats, { ...b, position: pos }); setEditing(null)
      }} />}
      {editingPlot && <PlotDialog c={campaign} onClose={() => setEditingPlot(false)} />}
      {deleting && <Confirm title="Delete beat?" body={`"${deleting.title}" will be removed from the outline.`} onConfirm={() => remove(db.beats, deleting)} onClose={() => setDeleting(null)} />}
    </>
  )
}

function BeatRow({ n, b, first, last, onOpen, onDelete, onMove, onStatus }: {
  n: number; b: BeatRow; first: boolean; last: boolean; onOpen: () => void; onDelete: () => void; onMove: (up: boolean) => void; onStatus: () => void
}) {
  const color = b.status === 'DONE' ? 'var(--moss)' : b.status === 'IN_PLAY' ? 'var(--gold)' : 'var(--faded)'
  return (
    <div className="beat" onClick={onOpen}>
      <div className="num">{n}</div>
      <div className="grow stack" style={{ gap: 4 }}>
        <div className="title-s">{b.title}</div>
        {b.summary && <div className="muted small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.summary.split('\n').filter(Boolean).join(' · ')}</div>}
        <div><button className="pill-o" style={{ color, borderColor: color, background: 'none', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onStatus() }}>{BEAT_STATUS[b.status as BeatStatus] ?? 'Planned'}</button></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" disabled={first} style={{ height: 32, opacity: first ? 0.3 : 1 }} onClick={() => onMove(true)} aria-label="Move up"><Icon n="chevron" style={{ transform: 'rotate(180deg)' }} /></button>
        <button className="icon-btn" disabled={last} style={{ height: 32, opacity: last ? 0.3 : 1 }} onClick={() => onMove(false)} aria-label="Move down"><Icon n="chevron" /></button>
      </div>
      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete() }} aria-label="Delete beat"><Icon n="trash" s={20} /></button>
    </div>
  )
}

function BeatDialog({ beat, onClose, onSave }: { beat: BeatRow; onClose: () => void; onSave: (b: BeatRow) => void }) {
  const [act, setAct] = useState(beat.act)
  const [title, setTitle] = useState(beat.title)
  const [summary, setSummary] = useState(beat.summary)
  const [status, setStatus] = useState(beat.status as BeatStatus)
  return (
    <FormModal title={beat.id ? 'Edit beat' : 'New beat'} onClose={onClose} canSave={!!title.trim()}
      onSave={() => onSave({ ...beat, act: act.trim(), title: title.trim(), summary: summary.trim(), status })}>
      <Field label="Act / chapter" value={act} onChange={setAct} placeholder="Act 1" />
      <Field label="Title" value={title} onChange={setTitle} autoFocus={!beat.id} />
      <Field label="What happens" value={summary} onChange={setSummary} multi rows={5} />
      <Select label="Status" value={status} onChange={setStatus} options={(Object.keys(BEAT_STATUS) as BeatStatus[]).map((s) => ({ value: s, label: BEAT_STATUS[s] }))} />
    </FormModal>
  )
}

function PlotDialog({ c, onClose }: { c: CampaignRow; onClose: () => void }) {
  const [name, setName] = useState(c.name)
  const [premise, setPremise] = useState(c.premise)
  const [setting, setSetting] = useState(c.setting)
  const [tone, setTone] = useState(c.tone)
  return (
    <FormModal title="Overall plot" onClose={onClose} canSave={!!name.trim()} onSave={async () => {
      await save(db.campaigns, { ...c, name: name.trim(), premise: premise.trim(), setting: setting.trim(), tone: tone.trim() }); onClose()
    }}>
      <Field label="Campaign name" value={name} onChange={setName} />
      <Field label="Overall plot" value={premise} onChange={setPremise} multi rows={7} placeholder="The villain, their plan, the stakes, how it might end" />
      <Field label="Setting" value={setting} onChange={setSetting} placeholder="e.g. Forgotten Realms, Sword Coast" />
      <Field label="Tone" value={tone} onChange={setTone} placeholder="e.g. grim, political, swashbuckling" />
      <div className="muted tiny">Everything here is given to the generators so ideas fit your story.</div>
    </FormModal>
  )
}
