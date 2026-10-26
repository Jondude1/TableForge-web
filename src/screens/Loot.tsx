import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, remove, save, type ItemRow, type PlayerRow } from '../lib/db'
import { RARITIES, rarityColor } from '../lib/types'
import { useApp } from '../store'
import { Confirm, Empty, Field, FormModal, Header, Icon, PillO, Select } from '../ui'

export default function Loot() {
  const { campaignId } = useApp()
  const players = useLiveQuery(() => db.players.where('campaignId').equals(campaignId).toArray(), [campaignId]) ?? []
  const items = useLiveQuery(() => db.items.where('campaignId').equals(campaignId).toArray(), [campaignId]) ?? []
  const [item, setItem] = useState<ItemRow | null>(null)
  const [player, setPlayer] = useState<PlayerRow | null>(null)
  const [delPlayer, setDelPlayer] = useState<PlayerRow | null>(null)
  const [delItem, setDelItem] = useState<ItemRow | null>(null)

  const newItem = (holderId: number | null): ItemRow =>
    ({ campaignId, holderId, name: '', rarity: 'Uncommon', requiresAttunement: false, attuned: false, charges: '', notes: '', acquiredAt: '', uid: '', updatedAt: 0 })
  const newPlayer = (): PlayerRow => ({ campaignId, playerName: '', characterName: '', characterClass: '', uid: '', updatedAt: 0 })
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))
  const stash = sorted.filter((i) => i.holderId == null || !players.some((p) => p.id === i.holderId))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header title="Party loot" sub={`${items.length} magic item${items.length === 1 ? '' : 's'} across ${players.length} character${players.length === 1 ? '' : 's'}`}>
        <button className="btn outline" onClick={() => setPlayer(newPlayer())}><Icon n="people" s={18} />Player</button>
        <button className="btn primary" onClick={() => setItem(newItem(null))}><Icon n="plus" s={18} />Item</button>
      </Header>
      {players.length === 0 && items.length === 0 ? (
        <Empty icon="loot" title="Who's carrying what?" body="Add each player and their character, then log magic items and hand them out. Saved magic items from Ideas can be sent here too.">
          <button className="btn tonal" onClick={() => setPlayer(newPlayer())}>Add the first player</button>
        </Empty>
      ) : (
        <div className="cols" style={{ flex: 1, height: 'auto' }}>
          {players.map((p) => {
            const mine = sorted.filter((i) => i.holderId === p.id)
            const att = mine.filter((i) => i.attuned).length
            return (
              <Column key={p.id} icon="loot" title={p.characterName || p.playerName}
                sub={[p.characterClass, p.playerName && `played by ${p.playerName}`].filter(Boolean).join(' · ')}
                note={<span className={att > 3 ? 'err' : 'muted'}>Attuned {att} / 3</span>}
                onEdit={() => setPlayer(p)} items={mine} onItem={setItem} onAdd={() => setItem(newItem(p.id!))} />
            )
          })}
          <Column icon="chest" title="Party stash" sub="Unclaimed or shared" items={stash} onItem={setItem} onAdd={() => setItem(newItem(null))} />
        </div>
      )}
      {item && <ItemDialog item={item} players={players} onClose={() => setItem(null)}
        onSave={async (i) => { await save(db.items, i); setItem(null) }}
        onDelete={item.id ? () => { setDelItem(item); setItem(null) } : undefined} />}
      {player && <PlayerDialog p={player} onClose={() => setPlayer(null)}
        onSave={async (p) => { await save(db.players, p); setPlayer(null) }}
        onDelete={player.id ? () => { setDelPlayer(player); setPlayer(null) } : undefined} />}
      {delPlayer && <Confirm title={`Remove ${delPlayer.characterName || delPlayer.playerName}?`} body="Their items move to the party stash." action="Remove"
        onConfirm={async () => {
          const held = await db.items.where('holderId').equals(delPlayer.id!).toArray()
          for (const i of held) await save(db.items, { ...i, holderId: null, attuned: false })
          await remove(db.players, delPlayer)
        }} onClose={() => setDelPlayer(null)} />}
      {delItem && <Confirm title={`Delete ${delItem.name}?`} body="It will be removed from the party's items." onConfirm={() => remove(db.items, delItem)} onClose={() => setDelItem(null)} />}
    </div>
  )
}

function Column({ icon, title, sub, note, items, onItem, onAdd, onEdit }: {
  icon: string; title: string; sub: string; note?: React.ReactNode; items: ItemRow[]; onItem: (i: ItemRow) => void; onAdd: () => void; onEdit?: () => void
}) {
  return (
    <div className="col">
      <div className="row">
        <span style={{ color: 'var(--gold)' }}><Icon n={icon} s={20} /></span>
        <div className="grow">
          <div className="title-s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          {sub && <div className="muted tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
        </div>
        {onEdit && <button className="icon-btn" onClick={onEdit} aria-label="Edit player"><Icon n="edit" s={18} /></button>}
      </div>
      {note && <div className="tiny" style={{ marginLeft: 28, fontFamily: 'var(--ui)', fontWeight: 600 }}>{note}</div>}
      <div className="list">
        {items.map((i) => {
          const c = rarityColor(i.rarity)
          return (
            <div key={i.id} className="card click stack" style={{ padding: 12, gap: 6, background: 'var(--leather)' }} onClick={() => onItem(i)}>
              <div className="title-s" style={{ color: c }}>{i.name}</div>
              <div className="chips" style={{ gap: 6 }}>
                <PillO text={i.rarity} color={c} />
                {i.requiresAttunement && <PillO text={i.attuned ? 'Attuned' : 'Needs attunement'} color={i.attuned ? 'var(--moss)' : 'var(--faded)'} />}
                {i.charges && <PillO text={`⚡ ${i.charges}`} color="var(--gold)" />}
              </div>
              {i.notes && <div className="muted tiny" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.notes.split('\n').filter(Boolean).join(' · ')}</div>}
              {i.acquiredAt && <div className="muted tiny">From: {i.acquiredAt}</div>}
            </div>
          )
        })}
        <button className="btn ghost" onClick={onAdd}><Icon n="plus" s={18} />Add item</button>
      </div>
    </div>
  )
}

function ItemDialog({ item, players, onClose, onSave, onDelete }: { item: ItemRow; players: PlayerRow[]; onClose: () => void; onSave: (i: ItemRow) => void; onDelete?: () => void }) {
  const [name, setName] = useState(item.name)
  const [rarity, setRarity] = useState(item.rarity)
  const [holder, setHolder] = useState<number>(item.holderId ?? -1)
  const [needs, setNeeds] = useState(item.requiresAttunement)
  const [attuned, setAttuned] = useState(item.attuned)
  const [charges, setCharges] = useState(item.charges)
  const [from, setFrom] = useState(item.acquiredAt)
  const [notes, setNotes] = useState(item.notes)
  return (
    <FormModal title={item.id ? 'Edit item' : 'New magic item'} onClose={onClose} canSave={!!name.trim()}
      left={onDelete && <button className="btn danger" onClick={onDelete}>Delete</button>}
      onSave={() => onSave({
        ...item, name: name.trim(), rarity, holderId: holder < 0 ? null : holder, requiresAttunement: needs,
        attuned: needs && attuned && holder >= 0, charges: charges.trim(), acquiredAt: from.trim(), notes: notes.trim(),
      })}>
      <Field label="Item name" value={name} onChange={setName} autoFocus={!item.id} />
      <Select label="Held by" value={holder} onChange={setHolder} options={[{ value: -1, label: 'Party stash' }, ...players.map((p) => ({ value: p.id!, label: p.characterName || p.playerName }))]} />
      <Select label="Rarity" value={rarity} onChange={setRarity} options={RARITIES.map((r) => ({ value: r, label: r }))} />
      <div className="row" style={{ flexWrap: 'wrap', gap: 18 }}>
        <label className="check"><input type="checkbox" checked={needs} onChange={(e) => setNeeds(e.target.checked)} />Requires attunement</label>
        {needs && holder >= 0 && <label className="check"><input type="checkbox" checked={attuned} onChange={(e) => setAttuned(e.target.checked)} />Attuned</label>}
      </div>
      <Field label="Charges / uses" value={charges} onChange={setCharges} placeholder="e.g. 3/7, regains 1d6+1 at dawn" />
      <Field label="Where it came from" value={from} onChange={setFrom} placeholder="e.g. Session 4, the lich's vault" />
      <Field label="Properties & notes" value={notes} onChange={setNotes} multi rows={4} />
    </FormModal>
  )
}

function PlayerDialog({ p, onClose, onSave, onDelete }: { p: PlayerRow; onClose: () => void; onSave: (p: PlayerRow) => void; onDelete?: () => void }) {
  const [character, setCharacter] = useState(p.characterName)
  const [player, setPlayer] = useState(p.playerName)
  const [cls, setCls] = useState(p.characterClass)
  return (
    <FormModal title={p.id ? 'Edit player' : 'Add player'} onClose={onClose} canSave={!!(character.trim() || player.trim())}
      left={onDelete && <button className="btn danger" onClick={onDelete}>Remove</button>}
      onSave={() => onSave({ ...p, characterName: character.trim(), playerName: player.trim(), characterClass: cls.trim() })}>
      <Field label="Character name" value={character} onChange={setCharacter} autoFocus={!p.id} />
      <Field label="Player name" value={player} onChange={setPlayer} />
      <Field label="Race & class" value={cls} onChange={setCls} placeholder="e.g. Tiefling Warlock 5" />
    </FormModal>
  )
}
