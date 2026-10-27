import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newUid, now } from './lib/db'
import { onSyncState, syncStates } from './lib/sync'
import { useApp } from './store'
import { Field, FormModal, Icon, Logo, useWide } from './ui'
import Forge from './screens/Forge'
import Story from './screens/Story'
import Ideas from './screens/Ideas'
import Concepts from './screens/Concepts'
import Maps from './screens/Maps'
import Loot from './screens/Loot'
import Monsters from './screens/Monsters'
import Tables from './screens/Tables'
import Settings from './screens/Settings'
import { UpdateBar } from './update'

export type TabId = 'forge' | 'story' | 'ideas' | 'concepts' | 'maps' | 'monsters' | 'loot' | 'tables' | 'settings'
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'forge', label: 'Forge', icon: 'forge' },
  { id: 'story', label: 'Story', icon: 'story' },
  { id: 'ideas', label: 'Ideas', icon: 'ideas' },
  { id: 'concepts', label: 'Concepts', icon: 'concepts' },
  { id: 'maps', label: 'Maps', icon: 'maps' },
  { id: 'monsters', label: 'Monsters', icon: 'monster' },
  { id: 'loot', label: 'Loot', icon: 'loot' },
  { id: 'tables', label: 'Tables', icon: 'tables' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]
// Phone bottom bar: the four most used at the table, plus More.
const PHONE: TabId[] = ['forge', 'story', 'maps', 'monsters']

export default function App() {
  const wide = useWide()
  const [tab, setTab] = useState<TabId>(() => (localStorage.getItem('tf.tab') as TabId) || 'forge')
  const [more, setMore] = useState(false)
  const go = (t: TabId) => { setTab(t); setMore(false); try { localStorage.setItem('tf.tab', t) } catch { /* ignore */ } }

  const screen = {
    forge: <Forge />, story: <Story />, ideas: <Ideas go={go} />, concepts: <Concepts />, maps: <Maps />, monsters: <Monsters />,
    loot: <Loot />, tables: <Tables />, settings: <Settings />,
  }[tab]

  return (
    <div className="shell">
      {wide && (
        <nav className="rail" aria-label="Sections">
          <Logo />
          {TABS.map((t) => (
            <span key={t.id} style={{ display: 'contents' }}>
              {t.id === 'settings' && <div className="spacer" />}
              <button className={`rail-item${tab === t.id ? ' on' : ''}`} onClick={() => go(t.id)} aria-current={tab === t.id}>
                <span className="pill"><Icon n={t.icon} /></span>{t.label}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div className="main">
        <UpdateBar />
        <TopBar onSettings={() => go('settings')} />
        <div className="content">{screen}</div>
        {!wide && (
          <nav className="tabbar" aria-label="Sections">
            {PHONE.map((id) => {
              const t = TABS.find((x) => x.id === id)!
              return (
                <button key={id} className={`tab${tab === id ? ' on' : ''}`} onClick={() => go(id)}>
                  <span className="pill"><Icon n={t.icon} /></span>{t.label}
                </button>
              )
            })}
            <button className={`tab${!PHONE.includes(tab) ? ' on' : ''}`} onClick={() => setMore(true)}>
              <span className="pill"><Icon n="more" s={26} /></span>{PHONE.includes(tab) ? 'More' : TABS.find((x) => x.id === tab)!.label}
            </button>
          </nav>
        )}
      </div>
      {more && (
        <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setMore(false) }}>
          <div className="dialog">
            <div className="d-body" style={{ padding: '16px 12px' }}>
              {TABS.filter((t) => !PHONE.includes(t.id)).map((t) => (
                <button key={t.id} className="btn outline block" style={{ justifyContent: 'flex-start', borderRadius: 14 }} onClick={() => go(t.id)}>
                  <Icon n={t.icon} /> {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function useSyncState(code?: string) {
  const sub = (cb: () => void) => onSyncState(cb)
  const snap = () => (code ? syncStates().get(code) : undefined)
  return useSyncExternalStore(sub, snap)
}

function TopBar({ onSettings }: { onSettings: () => void }) {
  const { campaign, setCampaignId } = useApp()
  const campaigns = useLiveQuery(() => db.campaigns.orderBy('createdAt').toArray(), []) ?? []
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const sync = useSyncState(campaign?.syncCode)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const status = !campaign?.syncCode ? null : sync?.status ?? 'connecting'
  const statusText = status === 'live' ? (sync?.pendingPush ? 'Syncing…' : 'Synced') : status === 'offline' ? 'Offline' : 'Connecting'

  return (
    <div className="topbar">
      <div ref={ref} style={{ position: 'relative', minWidth: 0 }}>
        <button className="camp-btn" onClick={() => setOpen(!open)} aria-haspopup="menu">
          <span>{campaign?.name ?? '…'}</span><Icon n="chevron" s={18} />
        </button>
        {open && (
          <div className="menu" style={{ top: 46, left: 0 }} role="menu">
            {campaigns.map((c) => (
              <button key={c.id} onClick={() => { setCampaignId(c.id!); setOpen(false) }}>
                <span className="grow">{c.name}</span>{c.id === campaign?.id && <Icon n="check" s={18} />}
              </button>
            ))}
            <hr />
            <button onClick={() => { setOpen(false); setCreating(true) }}><Icon n="plus" s={18} /> New campaign…</button>
            <button onClick={() => { setOpen(false); onSettings() }}><Icon n="sync" s={18} /> Join a campaign with a code…</button>
          </div>
        )}
      </div>
      <div className="grow" />
      {status && (
        <button className={`sync-dot ${status}`} onClick={onSettings} title="Sync status"><i />{statusText}</button>
      )}
      {creating && <NewCampaign onClose={() => setCreating(false)} onCreated={(id) => { setCampaignId(id); setCreating(false) }} />}
    </div>
  )
}

function NewCampaign({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('')
  const [premise, setPremise] = useState('')
  return (
    <FormModal title="New campaign" onClose={onClose} canSave={!!name.trim()} saveLabel="Create" onSave={async () => {
      const id = await db.campaigns.add({ name: name.trim(), premise: premise.trim(), tone: '', setting: '', createdAt: now(), uid: newUid(), updatedAt: now() })
      onCreated(id)
    }}>
      <Field label="Name" value={name} onChange={setName} autoFocus />
      <Field label="Overall plot (optional)" value={premise} onChange={setPremise} multi rows={4} />
    </FormModal>
  )
}
