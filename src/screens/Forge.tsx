import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, save } from '../lib/db'
import { generate, type Card } from '../lib/forge'
import { friendly } from '../lib/ai'
import { aiReady, useAi } from '../lib/settings'
import { GENERATABLE, IDEA_TYPES, type IdeaType } from '../lib/types'
import { useApp } from '../store'
import { Empty, ErrorBanner, Icon, Label, LabeledBody, Seg, TypeTag, useWide } from '../ui'
import { useKept } from './keep'

const VIBES = ['Darker', 'Funnier', 'Mysterious', 'Tied to the main plot', 'Low level (1-4)', 'High level', 'Urban', 'Wilderness', 'Morally gray', 'Weird / fey']

interface ForgeState { cards: Card[]; kept: string[]; saved: string[] }

export default function Forge() {
  const { campaignId, buildCtx, toast } = useApp()
  const ai = useAi()
  const wide = useWide()
  const [type, setType] = useKept<IdeaType>('forge.type', 'NPC')
  const [count, setCount] = useKept('forge.count', 4)
  const [steer, setSteer] = useKept('forge.steer', '')
  const [st, setSt] = useKept<ForgeState>(`forge.${campaignId}.${type}`, { cards: [], kept: [], saved: [] })
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
      const fresh = await generate(ai, ctx, type, need, steer, avoid)
      if (replace) setSt({ ...st, cards: st.cards.map((c) => (c.key === replace.key ? fresh[0] : c)) })
      else setSt({ ...st, cards: [...keptCards, ...fresh] })
    } catch (e) {
      setError(friendly(e))
    } finally {
      setLoading(false)
    }
  }

  const saveCard = async (c: Card) => {
    await save(db.ideas, { campaignId, type, title: c.title, body: c.body, tags: c.tags, isOwn: false, favorite: false, used: false, createdAt: Date.now(), uid: '', updatedAt: 0 })
    setSt({ ...st, saved: [...st.saved, c.key] })
    toast('Saved to Ideas')
  }

  const toggleVibe = (v: string) => {
    const on = steer.toLowerCase().includes(v.toLowerCase())
    setSteer(on ? steer.replace(new RegExp(`,?\\s*${v.replace(/[()]/g, '\\$&')}`, 'i'), '').replace(/^\s*,\s*/, '').trim() : [steer.trim(), v].filter(Boolean).join(', '))
  }

  const hasCards = st.cards.length > 0
  const controls = (
    <div className="stack-l" style={{ padding: wide ? 20 : '14px 14px 6px' }}>
      {wide && <div><h1 className="h1">The Forge</h1><div className="rule" /></div>}
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
      <button className="btn primary block" disabled={loading} onClick={() => run()}>
        {loading ? <span className="spinner" /> : <Icon n={hasCards ? 'refresh' : 'forge'} />}
        {!hasCards ? 'Generate' : st.kept.length ? 'Regenerate unpinned' : 'Regenerate all'}
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
        <Empty icon="forge" title={`Forge some ${IDEA_TYPES[type].label.toLowerCase()}`} body="Pick a type, say what you're after, and generate. Pin the ones you like, then regenerate the rest until everything fits." />
      ) : (
        <div className="masonry" style={{ padding: wide ? 18 : 14 }}>
          {st.cards.map((c) => (
            <IdeaCard key={c.key} card={c} type={type} kept={st.kept.includes(c.key)} saved={st.saved.includes(c.key)} busy={loading}
              onKeep={() => setSt({ ...st, kept: st.kept.includes(c.key) ? st.kept.filter((k) => k !== c.key) : [...st.kept, c.key] })}
              onReroll={() => run(c)}
              onDiscard={() => setSt({ ...st, cards: st.cards.filter((x) => x.key !== c.key), kept: st.kept.filter((k) => k !== c.key) })}
              onSave={() => saveCard(c)} />
          ))}
        </div>
      )}
    </>
  )

  return wide ? (
    <div className="split">
      <div className="side">{controls}</div>
      <div className="body">{results}</div>
    </div>
  ) : (
    <div className="scroll">{controls}{results}</div>
  )
}

export function IdeaCard({ card, type, kept, saved, busy, onKeep, onReroll, onDiscard, onSave, extra }: {
  card: Card; type: IdeaType; kept: boolean; saved: boolean; busy: boolean
  onKeep?: () => void; onReroll?: () => void; onDiscard: () => void; onSave: () => void; extra?: React.ReactNode
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
        <button className="icon-btn" onClick={onDiscard} title="Discard" aria-label="Discard"><Icon n="close" /></button>
        <div className="grow" />
        {extra}
        <button className="btn ghost" disabled={saved} onClick={onSave}><Icon n={saved ? 'check' : 'bookmark'} s={18} />{saved ? 'Saved' : 'Save'}</button>
      </div>
    </div>
  )
}
