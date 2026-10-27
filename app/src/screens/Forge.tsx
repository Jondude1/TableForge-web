import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, save } from '../lib/db'
import { fleshOut, generate, type Card } from '../lib/forge'
import { friendly } from '../lib/ai'
import { aiReady, useAi } from '../lib/settings'
import { GENERATABLE, IDEA_TYPES, type IdeaType } from '../lib/types'
import { useApp } from '../store'
import { Empty, ErrorBanner, Field, FormModal, Icon, Label, LabeledBody, Seg, TypeTag, useWide } from '../ui'
import { useKept } from './keep'

const VIBES = ['Darker', 'Funnier', 'Mysterious', 'Tied to the main plot', 'Low level (1-4)', 'High level', 'Urban', 'Wilderness', 'Morally gray', 'Weird / fey']

interface ForgeState { cards: Card[]; kept: string[]; saved: string[] }
export type ForgeMode = 'brainstorm' | 'own'
/** The DM's own idea being fleshed out. ideaId is set when it came from the Ideas tab. */
export interface OwnIdea { name: string; notes: string; versions: number; ideaId: number | null }
export const BLANK_OWN: OwnIdea = { name: '', notes: '', versions: 1, ideaId: null }

const OWN_HINT: Record<IdeaType, string> = {
  NPC: 'e.g. Half-orc, runs the Gilded Eel tavern. Gruff but fair. Secretly owes the thieves\' guild. Knew the party\'s cleric as a kid.',
  EVENT: 'e.g. The harvest festival is interrupted when the bell tower collapses during the opening speech.',
  LOCATION: 'e.g. A lighthouse on a sea stack, reachable only at low tide. The keeper vanished a month ago.',
  DUNGEON_ROOM: 'e.g. A flooded chapel with a drowned choir that still sings at midnight.',
  MAGIC_ITEM: 'e.g. A compass that points to whatever the holder fears most. Rare, needs attunement.',
  STORY_BEAT: 'e.g. The party learns the mayor they\'ve been helping is the cult leader.',
  NOTE: '',
}

export default function Forge() {
  const { campaignId, buildCtx, toast } = useApp()
  const ai = useAi()
  const wide = useWide()
  const [type, setType] = useKept<IdeaType>('forge.type', 'NPC')
  const [count, setCount] = useKept('forge.count', 4)
  const [steer, setSteer] = useKept('forge.steer', '')
  const [mode, setMode] = useKept<ForgeMode>('forge.mode', 'brainstorm')
  const [own, setOwn] = useKept<OwnIdea>('forge.own', BLANK_OWN)
  const [st, setSt] = useKept<ForgeState>(`forge.${campaignId}.${type}.${mode}`, { cards: [], kept: [], saved: [] })
  const [editing, setEditing] = useState<Card | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedIdeas = useLiveQuery(() => db.ideas.where('campaignId').equals(campaignId).toArray(), [campaignId]) ?? []

  const run = async (replace?: Card) => {
    const ctx = await buildCtx()
    if (!ctx) return
    setLoading(true); setError(null)
    try {
      const keptCards = st.cards.filter((c) => st.kept.includes(c.key))
      const need = replace ? 1 : Math.max(1, count - keptCards.length)
      const avoid = [...st.cards.map((c) => c.title), ...savedIdeas.filter((i) => i.type === type).map((i) => i.title).slice(0, 30)]
      const fresh = mode === 'own'
        ? await fleshOut(ai, ctx, type, own.name, own.notes, replace ? 1 : Math.max(1, own.versions - keptCards.length),
          replace || st.cards.length ? st.cards.map((c) => c.body.split('\n').slice(0, 2).join(' ').slice(0, 120)) : [])
        : await generate(ai, ctx, type, need, steer, avoid)
      if (replace) setSt({ ...st, cards: st.cards.map((c) => (c.key === replace.key ? fresh[0] : c)) })
      else setSt({ ...st, cards: [...keptCards, ...fresh] })
    } catch (e) {
      setError(friendly(e))
    } finally {
      setLoading(false)
    }
  }

  const saveCard = async (c: Card) => {
    const existing = mode === 'own' && own.ideaId != null ? await db.ideas.get(own.ideaId) : undefined
    if (existing) {
      await save(db.ideas, { ...existing, type, title: c.title, body: c.body, tags: c.tags || existing.tags })
      toast(`Updated ${c.title} in Ideas`)
    } else {
      await save(db.ideas, { campaignId, type, title: c.title, body: c.body, tags: c.tags, isOwn: mode === 'own', favorite: false, used: false, createdAt: Date.now(), uid: '', updatedAt: 0 })
      toast('Saved to Ideas')
    }
    setSt({ ...st, saved: [...st.saved, c.key] })
  }

  const toggleVibe = (v: string) => {
    const on = steer.toLowerCase().includes(v.toLowerCase())
    setSteer(on ? steer.replace(new RegExp(`,?\\s*${v.replace(/[()]/g, '\\$&')}`, 'i'), '').replace(/^\s*,\s*/, '').trim() : [steer.trim(), v].filter(Boolean).join(', '))
  }

  const hasCards = st.cards.length > 0
  const controls = (
    <div className="stack-l" style={{ padding: wide ? 20 : '14px 14px 6px' }}>
      {wide && <div><h1 className="h1">The Forge</h1><div className="rule" /></div>}
      <Seg value={mode} onChange={(m) => { setMode(m); setError(null) }} options={[
        { value: 'brainstorm', label: <><Icon n="forge" s={16} />Brainstorm</> },
        { value: 'own', label: <><Icon n="edit" s={16} />Flesh out mine</> },
      ]} />
      <div className="stack">
        <Label>What to make</Label>
        <div className={`chips${wide ? '' : ' scrollx'}`}>
          {GENERATABLE.map((t) => (
            <button key={t} className={`chip${t === type ? ' on' : ''}`} onClick={() => { setType(t); setError(null) }}>
              <span className="dot" style={{ background: IDEA_TYPES[t].color }} />{IDEA_TYPES[t].label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'brainstorm' ? (
        <>
          <div className="stack">
            <Label>How many</Label>
            <Seg value={count} onChange={setCount} options={[1, 3, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))} />
          </div>
          <div className="stack">
            <Label>What you're looking for</Label>
            <textarea className="textarea" rows={wide ? 3 : 2} value={steer} onChange={(e) => setSteer(e.target.value)} placeholder="e.g. a dwarf merchant who secretly works for the cult" />
            <div className={`chips${wide ? '' : ' scrollx'}`}>
              {VIBES.map((v) => <button key={v} className={`chip${steer.toLowerCase().includes(v.toLowerCase()) ? ' on' : ''}`} onClick={() => toggleVibe(v)}>{v}</button>)}
            </div>
          </div>
        </>
      ) : (
        <>
          {own.ideaId != null && (
            <div className="banner ok" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="grow small">Fleshing out a saved idea. Saving updates it.</span>
              <button className="btn ghost sm" onClick={() => setOwn({ ...own, ideaId: null })}>Save as new</button>
            </div>
          )}
          <Field label="Name" value={own.name} onChange={(name) => setOwn({ ...own, name })} placeholder={type === 'NPC' ? 'e.g. Marta Vey' : 'Leave blank to have one invented'} />
          <Field label="What you already know" value={own.notes} onChange={(notes) => setOwn({ ...own, notes })} multi rows={wide ? 5 : 4} placeholder={OWN_HINT[type]} />
          <div className="muted tiny" style={{ marginTop: -8 }}>Everything you write here is kept exactly. Claude only fills in what's missing.</div>
          <div className="stack">
            <Label>Versions to compare</Label>
            <Seg value={own.versions} onChange={(versions) => setOwn({ ...own, versions })} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
          </div>
        </>
      )}
      <button className="btn primary block" disabled={loading || (mode === 'own' && !own.name.trim() && !own.notes.trim())} onClick={() => run()}>
        {loading ? <span className="spinner" /> : <Icon n={hasCards ? 'refresh' : 'forge'} />}
        {mode === 'own'
          ? (!hasCards ? 'Flesh it out' : st.kept.length ? 'Try again (keep pinned)' : 'Try again')
          : (!hasCards ? 'Generate' : st.kept.length ? 'Regenerate unpinned' : 'Regenerate all')}
      </button>
      {!aiReady(ai) && <div className="muted tiny">Offline mode — using built-in tables. Add a Claude API key in Settings for ideas written around your campaign.</div>}
      {hasCards && wide && <button className="btn ghost" onClick={() => setSt({ cards: [], kept: [], saved: [] })}>Clear results</button>}
    </div>
  )

  const results = (
    <>
      {loading && <div className="progress" />}
      {error && <ErrorBanner msg={error} />}
      {!hasCards && !loading ? (
        mode === 'own'
          ? <Empty icon="edit" title={`Flesh out your ${IDEA_TYPES[type].singular}`} body="Give it a name and whatever you already know. Claude keeps your details exactly and fills in the rest. Edit anything before you save it." />
          : <Empty icon="forge" title={`Forge some ${IDEA_TYPES[type].label.toLowerCase()}`} body="Pick a type, say what you're after, and generate. Pin the ones you like, then regenerate the rest until everything fits." />
      ) : (
        <div className="masonry" style={{ padding: wide ? 18 : 14 }}>
          {st.cards.map((c) => (
            <IdeaCard key={c.key} card={c} type={type} kept={st.kept.includes(c.key)} saved={st.saved.includes(c.key)} busy={loading}
              onKeep={() => setSt({ ...st, kept: st.kept.includes(c.key) ? st.kept.filter((k) => k !== c.key) : [...st.kept, c.key] })}
              onReroll={() => run(c)}
              onDiscard={() => setSt({ ...st, cards: st.cards.filter((x) => x.key !== c.key), kept: st.kept.filter((k) => k !== c.key) })}
              onSave={() => saveCard(c)} onEdit={() => setEditing(c)}
              saveLabel={mode === 'own' && own.ideaId != null ? 'Update' : undefined} />
          ))}
        </div>
      )}
    </>
  )

  const editModal = editing && (
    <EditCard card={editing} onClose={() => setEditing(null)} onSave={(c) => {
      setSt({ ...st, cards: st.cards.map((x) => (x.key === c.key ? c : x)), saved: st.saved.filter((k) => k !== c.key) })
      setEditing(null)
    }} />
  )

  return wide ? (
    <div className="split">
      <div className="side">{controls}</div>
      <div className="body">{results}</div>
      {editModal}
    </div>
  ) : (
    <div className="scroll">{controls}{results}{editModal}</div>
  )
}

export function IdeaCard({ card, type, kept, saved, busy, onKeep, onReroll, onDiscard, onSave, extra, onEdit, saveLabel }: {
  card: Card; type: IdeaType; kept: boolean; saved: boolean; busy: boolean
  onKeep?: () => void; onReroll?: () => void; onDiscard: () => void; onSave: () => void; extra?: React.ReactNode
  onEdit?: () => void; saveLabel?: string
}) {
  const accent = IDEA_TYPES[type].color
  return (
    <div className={`card stack ${kept ? 'kept' : saved ? 'saved' : 'dashed'}`} style={{ '--accent': accent } as React.CSSProperties}>
      <div className="row"><TypeTag type={type} /><div className="grow" />{kept && <span className="label" style={{ color: accent }}>Pinned</span>}</div>
      <h3 className="title">{card.title}</h3>
      <LabeledBody body={card.body} />
      {card.tags && <div className="chips">{card.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <span key={t} className="pill-o" style={{ color: 'var(--faded)', borderColor: 'var(--seam)' }}>#{t}</span>)}</div>}
      <div className="row-actions">
        {onKeep && <button className={`icon-btn${kept ? ' on' : ''}`} onClick={onKeep} title={kept ? 'Unpin' : 'Pin (keep when regenerating)'} aria-label="Pin"><Icon n="pin" fill={kept} /></button>}
        {onReroll && <button className="icon-btn" onClick={onReroll} disabled={busy} title="Regenerate this one" aria-label="Regenerate this one"><Icon n="refresh" /></button>}
        {onEdit && <button className="icon-btn" onClick={onEdit} title="Edit before saving" aria-label="Edit"><Icon n="edit" /></button>}
        <button className="icon-btn" onClick={onDiscard} title="Discard" aria-label="Discard"><Icon n="close" /></button>
        <div className="grow" />
        {extra}
        <button className="btn ghost" disabled={saved} onClick={onSave}><Icon n={saved ? 'check' : 'bookmark'} s={18} />{saved ? 'Saved' : saveLabel ?? 'Save'}</button>
      </div>
    </div>
  )
}

function EditCard({ card, onClose, onSave }: { card: Card; onClose: () => void; onSave: (c: Card) => void }) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  return (
    <FormModal title="Edit before saving" onClose={onClose} canSave={!!title.trim()} saveLabel="Done"
      onSave={() => onSave({ ...card, title: title.trim(), body: body.trim() })}>
      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Details" value={body} onChange={setBody} multi rows={10} />
      <div className="muted tiny">Keep "Label: text" lines to get the tidy layout.</div>
    </FormModal>
  )
}
