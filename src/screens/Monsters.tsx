import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, remove, save, type MonsterRow } from '../lib/db'
import { friendly, type ImagePart } from '../lib/ai'
import { fromPhotos, fromText, generate, prepareImage, rollDice, rollable, splitNamed } from '../lib/monsterforge'
import { aiReady, useAi } from '../lib/settings'
import { ABILITIES, blankStatBlock, fmtMod, maxHp, mod, type NamedText, type StatBlock } from '../lib/types'
import { useApp } from '../store'
import { Confirm, Empty, Field, FormModal, Header, Icon, Label, Modal, useWide } from '../ui'
import { useKept } from './keep'

type AddMode = 'menu' | 'photo' | 'text' | 'make'

export default function Monsters() {
  const { campaignId, toast } = useApp()
  const wide = useWide()
  const monsters = useLiveQuery(() => db.monsters.where('campaignId').equals(campaignId).toArray(), [campaignId]) ?? []
  const [selected, setSelected] = useKept<number | null>(`monsters.${campaignId}.sel`, null)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState<AddMode | null>(null)
  const [editing, setEditing] = useState<MonsterRow | null>(null)
  const [deleting, setDeleting] = useState<MonsterRow | null>(null)
  const list = [...monsters].sort((a, b) => a.name.localeCompare(b.name)).filter((m) => !q || `${m.name} ${m.data.meta}`.toLowerCase().includes(q.toLowerCase()))
  const sel = monsters.find((m) => m.id === selected) ?? (wide ? list[0] : undefined)

  const store = async (data: StatBlock) => {
    const id = await save(db.monsters, { campaignId, name: data.name, cr: data.cr, data, hpNow: maxHp(data.hp), createdAt: Date.now(), uid: '', updatedAt: 0 })
    setSelected(id); setAdding(null)
    toast(`${data.name} added`)
  }

  const listPane = (
    <div>
      <Header title="Monsters" sub="Stat blocks — scan a book page, paste, or create">
        <button className="btn primary" onClick={() => setAdding('menu')}><Icon n="plus" s={18} />Monster</button>
      </Header>
      <div className="pad stack">
        {monsters.length > 0 && (
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faded)' }}><Icon n="search" s={20} /></span>
            <input className="input" style={{ paddingLeft: 40 }} placeholder="Search monsters" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        {list.map((m) => (
          <button key={m.id} className="card click row" onClick={() => setSelected(m.id!)}
            style={{ textAlign: 'left', padding: 12, gap: 12, background: m.id === sel?.id && wide ? 'rgba(92,70,32,.45)' : 'var(--hearth)', borderColor: m.id === sel?.id && wide ? 'rgba(212,168,75,.55)' : undefined }}>
            <span style={{ color: 'var(--crimson)' }}><Icon n="monster" s={26} /></span>
            <div className="grow">
              <div className="title-s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
              <div className="muted tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.data.meta || '—'}</div>
            </div>
            {m.cr && <span className="pill-o" style={{ color: 'var(--gold)', borderColor: 'rgba(212,168,75,.5)' }}>CR {m.cr.split(' ')[0]}</span>}
          </button>
        ))}
        {monsters.length === 0 && (
          <Empty icon="monster" title="No monsters yet" body="Snap a photo of a stat block from any book and it becomes a tappable stat block here — roll attacks and damage, and track hit points in combat.">
            <button className="btn primary" onClick={() => setAdding('photo')}><Icon n="camera" s={18} />Scan a stat block</button>
          </Empty>
        )}
      </div>
    </div>
  )

  const detail = sel ? (
    <MonsterDetail key={sel.id} m={sel} back={!wide ? () => setSelected(null) : undefined}
      onEdit={() => setEditing(sel)} onDelete={() => setDeleting(sel)}
      onCopy={async () => {
        const data = { ...sel.data, name: `${sel.data.name} (copy)` }
        const id = await save(db.monsters, { campaignId, name: data.name, cr: data.cr, data, hpNow: maxHp(data.hp), createdAt: Date.now(), uid: '', updatedAt: 0 })
        setSelected(id)
      }} />
  ) : <Empty icon="monster" title="Pick a monster" body="Choose a stat block, or add a new one." />

  return (
    <>
      {wide ? (
        <div className="split"><div className="side">{listPane}</div><div className="body">{detail}</div></div>
      ) : (
        <div className="scroll">{selected != null && sel ? detail : listPane}</div>
      )}
      {adding && <AddMonster mode={adding} setMode={setAdding} onDone={store} onBlank={() => { setAdding(null); setEditing({ campaignId, name: '', cr: '', data: blankStatBlock(), hpNow: null, createdAt: Date.now(), uid: '', updatedAt: 0 }) }} />}
      {editing && <MonsterEditor m={editing} onClose={() => setEditing(null)} onSave={async (data) => {
        const hpChanged = data.hp !== editing.data.hp
        const id = await save(db.monsters, { ...editing, name: data.name, cr: data.cr, data, hpNow: hpChanged || editing.hpNow == null ? maxHp(data.hp) : editing.hpNow })
        setSelected(id); setEditing(null)
      }} />}
      {deleting && <Confirm title={`Delete ${deleting.name}?`} body="This stat block will be removed." onConfirm={() => { void remove(db.monsters, deleting); setSelected(null) }} onClose={() => setDeleting(null)} />}
    </>
  )
}

// ---------- Adding ----------

function AddMonster({ mode, setMode, onDone, onBlank }: { mode: AddMode; setMode: (m: AddMode | null) => void; onDone: (b: StatBlock) => void; onBlank: () => void }) {
  const ai = useAi()
  const { campaign } = useApp()
  const ready = aiReady(ai)
  const [images, setImages] = useState<{ url: string; part: ImagePart }[]>([])
  const [text, setText] = useState('')
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<StatBlock | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const close = () => setMode(null)

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setErr(null)
    try {
      const added = await Promise.all([...files].slice(0, 4 - images.length).map(async (f) => ({ url: URL.createObjectURL(f), part: await prepareImage(f) })))
      setImages([...images, ...added])
    } catch (e) { setErr(friendly(e)) }
  }

  const run = async (f: () => Promise<StatBlock>) => {
    setBusy(true); setErr(null)
    try { setResult(await f()) } catch (e) { setErr(friendly(e)) } finally { setBusy(false) }
  }

  if (result) {
    return (
      <Modal title="Check it over" onClose={close} footer={<>
        <button className="btn ghost" onClick={() => setResult(null)}>Back</button>
        <div className="grow" />
        <button className="btn primary" onClick={() => onDone(result)}>Save monster</button>
      </>}>
        <div className="muted small">Compare with the original. You can fix anything after saving with Edit.</div>
        <StatBlockView b={result} />
      </Modal>
    )
  }

  if (mode === 'menu') {
    const opt = (icon: string, title: string, sub: string, f: () => void, needs = true) => (
      <button className="card click row" style={{ textAlign: 'left', gap: 14, padding: 14, opacity: needs && !ready ? 0.55 : 1 }} onClick={f}>
        <span style={{ color: 'var(--gold)' }}><Icon n={icon} s={26} /></span>
        <div className="grow"><div className="title-s">{title}</div><div className="muted tiny">{sub}</div></div>
      </button>
    )
    return (
      <Modal title="Add a monster" onClose={close} footer={<button className="btn ghost" onClick={close}>Cancel</button>}>
        {opt('camera', 'Scan a stat block', 'Take a photo of a book page — Claude reads it', () => setMode('photo'))}
        {opt('copy', 'Paste text', 'From a PDF, D&D Beyond, or a website', () => setMode('text'))}
        {opt('forge', 'Create with Claude', 'Describe it and get a balanced stat block', () => setMode('make'))}
        {opt('edit', 'Start blank', 'Type it in yourself', onBlank, false)}
        {!ready && <div className="muted tiny">Scanning, pasting and creating need a Claude API key (Settings). Start blank works offline.</div>}
      </Modal>
    )
  }

  const go = mode === 'photo' ? () => run(() => fromPhotos(ai, images.map((i) => i.part)))
    : mode === 'text' ? () => run(() => fromText(ai, text))
      : () => run(() => generate(ai, idea, [campaign.name, campaign.setting, campaign.tone].filter(Boolean).join(' · ')))
  const can = mode === 'photo' ? images.length > 0 : mode === 'text' ? text.trim().length > 20 : idea.trim().length > 2

  return (
    <Modal title={mode === 'photo' ? 'Scan a stat block' : mode === 'text' ? 'Paste a stat block' : 'Create a monster'} onClose={close} footer={<>
      <button className="btn ghost" onClick={() => setMode('menu')}>Back</button>
      <div className="grow" />
      <button className="btn primary" disabled={!can || busy} onClick={go}>
        {busy ? <><span className="spinner" />{mode === 'make' ? 'Creating…' : 'Reading…'}</> : mode === 'make' ? 'Create' : 'Read stat block'}
      </button>
    </>}>
      {mode === 'photo' && (
        <>
          <div className="muted small">Lay the page flat in good light and fill the frame with the stat block. If it runs across two columns or pages, add a photo of each part (up to 4).</div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = '' }} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {images.map((im, i) => (
              <div key={im.url} style={{ position: 'relative' }}>
                <img src={im.url} alt={`Photo ${i + 1}`} style={{ width: 96, height: 128, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--seam)' }} />
                <button className="icon-btn" aria-label="Remove photo" style={{ position: 'absolute', top: -10, right: -10, background: 'var(--leather-hi)', width: 30, height: 30 }}
                  onClick={() => setImages(images.filter((_, j) => j !== i))}><Icon n="close" s={16} /></button>
              </div>
            ))}
            {images.length < 4 && (
              <button className="card click" onClick={() => fileRef.current?.click()}
                style={{ width: 96, height: 128, display: 'grid', placeItems: 'center', borderStyle: 'dashed', color: 'var(--gold)', padding: 0 }}>
                <div style={{ textAlign: 'center' }}><Icon n="camera" s={28} /><div className="tiny">{images.length ? 'Add part' : 'Take / choose photo'}</div></div>
              </button>
            )}
          </div>
        </>
      )}
      {mode === 'text' && <Field label="Stat block text" value={text} onChange={setText} multi rows={10} placeholder={'Goblin\nSmall humanoid (goblinoid), neutral evil\nArmor Class 15 (leather armor, shield)\n…'} autoFocus />}
      {mode === 'make' && <Field label="Describe the monster" value={idea} onChange={setIdea} multi rows={4} placeholder="e.g. a CR 5 drowned bell-ringer ghost that haunts the harbor, with a deafening toll attack" autoFocus />}
      {busy && <div className="progress" />}
      {err && <div className="err small">{err}</div>}
    </Modal>
  )
}

// ---------- Viewing ----------

function MonsterDetail({ m, back, onEdit, onDelete, onCopy }: { m: MonsterRow; back?: () => void; onEdit: () => void; onDelete: () => void; onCopy: () => void }) {
  const { toast } = useApp()
  const max = maxHp(m.data.hp)
  const hp = m.hpNow ?? max
  const [amount, setAmount] = useState('')
  const [last, setLast] = useState<string | null>(null)

  const setHp = (v: number) => { void save(db.monsters, { ...m, hpNow: Math.max(0, max != null ? Math.min(max, v) : v) }) }
  const apply = (sign: 1 | -1) => {
    const n = Number(amount)
    if (!n || hp == null) return
    setHp(hp + sign * n); setAmount('')
  }
  const onRoll = (label: string, result: string) => { setLast(`${label}: ${result}`); toast(`${label}: ${result}`) }

  return (
    <div className="pad stack-l" style={{ paddingTop: 14, maxWidth: 760 }}>
      <div className="row">
        {back && <button className="icon-btn" onClick={back} aria-label="Back"><Icon n="back" /></button>}
        <div className="grow" />
        <button className="btn ghost sm" onClick={onCopy}><Icon n="copy" s={16} />Duplicate</button>
        <button className="icon-btn" onClick={onEdit} aria-label="Edit"><Icon n="edit" /></button>
        <button className="icon-btn" onClick={onDelete} aria-label="Delete"><Icon n="trash" /></button>
      </div>

      {max != null && hp != null && (
        <div className="card stack" style={{ background: 'var(--hearth)' }}>
          <div className="row">
            <Label style={{ flex: 1 }}>Hit points</Label>
            {hp !== max && <button className="btn ghost sm" onClick={() => setHp(max)}>Reset</button>}
          </div>
          <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 34, color: hp === 0 ? 'var(--error)' : hp <= max / 2 ? 'var(--gold)' : 'var(--parchment)' }}>{hp}</span>
            <span className="muted">/ {max}{hp === 0 ? ' · down' : hp <= max / 2 ? ' · bloodied' : ''}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--seam-soft)', overflow: 'hidden' }}>
            <div style={{ width: `${(hp / max) * 100}%`, height: '100%', background: hp <= max / 2 ? 'var(--crimson)' : 'var(--moss)', transition: 'width .2s' }} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 110 }} inputMode="numeric" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
            <button className="btn outline" style={{ color: 'var(--error)' }} disabled={!amount} onClick={() => apply(-1)}>Damage</button>
            <button className="btn outline" style={{ color: 'var(--moss)' }} disabled={!amount} onClick={() => apply(1)}>Heal</button>
          </div>
        </div>
      )}

      <StatBlockView b={m.data} onRoll={onRoll} />
      {last && <div className="muted tiny">Last roll — {last}</div>}
      <div className="muted tiny">Tap a gold attack bonus or damage roll to roll it.</div>
    </div>
  )
}

/** The classic 5e stat block: parchment, red rules and headings. */
export function StatBlockView({ b, onRoll }: { b: StatBlock; onRoll?: (label: string, result: string) => void }) {
  const props = ([
    ['Saving Throws', b.saves], ['Skills', b.skills], ['Damage Vulnerabilities', b.vulnerabilities], ['Damage Resistances', b.resistances],
    ['Damage Immunities', b.immunities], ['Condition Immunities', b.conditionImmunities], ['Senses', b.senses], ['Languages', b.languages], ['Challenge', b.cr],
  ] as [string, string][]).filter(([, v]) => v)
  const section = (title: string, items: NamedText[], intro?: string) => (items.length > 0 || intro) && (
    <>
      <h4 className="sb-h">{title}</h4>
      {intro && <p className="sb-p">{intro}</p>}
      {items.map((t, i) => <p key={i} className="sb-p">{t.name && <b><i>{t.name}.</i></b>} <Rollable text={t.text} label={t.name || title} onRoll={onRoll} /></p>)}
    </>
  )
  return (
    <div className="statblock">
      <h3 className="sb-name">{b.name || 'Unnamed creature'}</h3>
      {b.meta && <div className="sb-meta">{b.meta}</div>}
      <div className="sb-rule" />
      <div className="sb-line"><b>Armor Class</b> {b.ac || '—'}</div>
      <div className="sb-line"><b>Hit Points</b> {b.hp ? <Rollable text={b.hp} label="Hit points" onRoll={onRoll} /> : '—'}</div>
      <div className="sb-line"><b>Speed</b> {b.speed || '—'}</div>
      <div className="sb-rule" />
      <div className="sb-abilities">
        {ABILITIES.map((a) => (
          <button key={a} className="sb-ab" disabled={!onRoll} onClick={() => {
            const r = rollDice(1, 20, mod(b[a]))
            onRoll?.(`${a.toUpperCase()} check`, `${r.total} (d20 ${r.rolls[0]} ${fmtMod(mod(b[a]))})`)
          }}>
            <div className="sb-abn">{a.toUpperCase()}</div>
            <div>{b[a]} ({fmtMod(mod(b[a]))})</div>
          </button>
        ))}
      </div>
      <div className="sb-rule" />
      {props.map(([k, v]) => <div key={k} className="sb-line"><b>{k}</b> {v}</div>)}
      {props.length > 0 && <div className="sb-rule" />}
      {b.traits.map((t, i) => <p key={i} className="sb-p">{t.name && <b><i>{t.name}.</i></b>} <Rollable text={t.text} label={t.name} onRoll={onRoll} /></p>)}
      {section('Actions', b.actions)}
      {section('Bonus Actions', b.bonusActions)}
      {section('Reactions', b.reactions)}
      {section('Legendary Actions', b.legendary, b.legendaryIntro)}
      {b.notes && <><h4 className="sb-h">Notes</h4><p className="sb-p" style={{ whiteSpace: 'pre-wrap' }}>{b.notes}</p></>}
    </div>
  )
}

function Rollable({ text, label, onRoll }: { text: string; label: string; onRoll?: (label: string, result: string) => void }) {
  if (!onRoll) return <>{text}</>
  return (
    <>
      {rollable(text).map((s, i) => {
        if (s.t === 'text') return <span key={i}>{s.s}</span>
        if (s.t === 'hit') return (
          <button key={i} className="sb-roll" onClick={() => {
            const r = rollDice(1, 20, s.bonus), d = r.rolls[0]
            onRoll(`${label} attack`, `${r.total}${d === 20 ? ' — NATURAL 20!' : d === 1 ? ' — natural 1' : ''} (d20 ${d} ${fmtMod(s.bonus)})`)
          }}>{s.s}</button>
        )
        return (
          <button key={i} className="sb-roll" onClick={() => {
            const r = rollDice(s.n, s.d, s.plus)
            onRoll(label === 'Hit points' ? 'Rolled hit points' : `${label} damage`, `${r.total} (${r.rolls.join(' + ')}${s.plus ? ` ${s.plus > 0 ? '+' : '−'} ${Math.abs(s.plus)}` : ''})`)
          }}>{s.s}</button>
        )
      })}
    </>
  )
}

// ---------- Editing ----------

const joinNamed = (l: NamedText[]) => l.map((t) => (t.name ? `${t.name}. ${t.text}` : t.text)).join('\n\n')
const splitList = (s: string): NamedText[] => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map(splitNamed)

function MonsterEditor({ m, onClose, onSave }: { m: MonsterRow; onClose: () => void; onSave: (b: StatBlock) => void }) {
  const [b, setB] = useState<StatBlock>(m.data)
  const [lists, setLists] = useState({
    traits: joinNamed(m.data.traits), actions: joinNamed(m.data.actions), bonusActions: joinNamed(m.data.bonusActions),
    reactions: joinNamed(m.data.reactions), legendary: joinNamed(m.data.legendary),
  })
  const f = (k: keyof StatBlock) => (v: string) => setB({ ...b, [k]: v })
  const listField = (k: keyof typeof lists, label: string) => (
    <Field label={label} value={lists[k]} onChange={(v) => setLists({ ...lists, [k]: v })} multi rows={k === 'actions' ? 6 : 3}
      placeholder={'Name. What it does.\n\nNext one. Separate entries with a blank line.'} />
  )
  return (
    <FormModal title={m.id ? `Edit ${m.name}` : 'New monster'} onClose={onClose} canSave={!!b.name.trim()} onSave={() => onSave({
      ...b, name: b.name.trim(),
      traits: splitList(lists.traits), actions: splitList(lists.actions), bonusActions: splitList(lists.bonusActions),
      reactions: splitList(lists.reactions), legendary: splitList(lists.legendary),
    })}>
      <Field label="Name" value={b.name} onChange={f('name')} autoFocus={!m.id} />
      <Field label="Size, type, alignment" value={b.meta} onChange={f('meta')} placeholder="Medium undead, chaotic evil" />
      <div className="row" style={{ gap: 10 }}>
        <div className="grow"><Field label="Armor Class" value={b.ac} onChange={f('ac')} placeholder="15 (leather armor)" /></div>
        <div className="grow"><Field label="Hit Points" value={b.hp} onChange={f('hp')} placeholder="22 (4d8 + 4)" /></div>
      </div>
      <Field label="Speed" value={b.speed} onChange={f('speed')} />
      <div className="stack">
        <Label>Ability scores</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
          {ABILITIES.map((a) => (
            <label key={a} className="field" style={{ gap: 2, textAlign: 'center' }}>
              <span>{a.toUpperCase()}</span>
              <input className="input" style={{ padding: '10px 4px', textAlign: 'center' }} inputMode="numeric" value={String(b[a])}
                onChange={(e) => setB({ ...b, [a]: Math.min(30, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
            </label>
          ))}
        </div>
      </div>
      <Field label="Saving throws" value={b.saves} onChange={f('saves')} placeholder="Dex +5, Wis +3" />
      <Field label="Skills" value={b.skills} onChange={f('skills')} />
      <Field label="Damage resistances" value={b.resistances} onChange={f('resistances')} />
      <Field label="Damage immunities" value={b.immunities} onChange={f('immunities')} />
      <Field label="Damage vulnerabilities" value={b.vulnerabilities} onChange={f('vulnerabilities')} />
      <Field label="Condition immunities" value={b.conditionImmunities} onChange={f('conditionImmunities')} />
      <Field label="Senses" value={b.senses} onChange={f('senses')} placeholder="darkvision 60 ft., passive Perception 12" />
      <Field label="Languages" value={b.languages} onChange={f('languages')} />
      <Field label="Challenge" value={b.cr} onChange={f('cr')} placeholder="2 (450 XP)" />
      {listField('traits', 'Traits')}
      {listField('actions', 'Actions')}
      {listField('bonusActions', 'Bonus actions')}
      {listField('reactions', 'Reactions')}
      <Field label="Legendary actions intro" value={b.legendaryIntro} onChange={f('legendaryIntro')} multi rows={2} />
      {listField('legendary', 'Legendary actions')}
      <Field label="Notes" value={b.notes} onChange={f('notes')} multi rows={3} />
    </FormModal>
  )
}
