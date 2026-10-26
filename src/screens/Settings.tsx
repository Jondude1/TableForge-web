import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteCampaignCascade } from '../lib/db'
import { complete, friendly } from '../lib/ai'
import { DEFAULT_MODEL, saveAi, useAi, type AiSettings } from '../lib/settings'
import { joinCampaign, linkCampaign, normalizeCode, onSyncState, syncStates, unlinkCampaign } from '../lib/sync'
import { useApp } from '../store'
import { Confirm, Field, Header, Icon, Label, Seg } from '../ui'

export default function Settings() {
  return (
    <div className="scroll">
      <Header title="Settings" />
      <div className="pad stack-l" style={{ maxWidth: 760 }}>
        <SyncCard />
        <AiCard />
        <InstallCard />
        <CampaignCard />
        <AboutCard />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card stack" style={{ background: 'var(--hearth)', padding: 20 }}><Label>{title}</Label>{children}</section>
}

function useSync(code?: string) {
  return useSyncExternalStore((cb) => onSyncState(cb), () => (code ? syncStates().get(code) : undefined))
}

function SyncCard() {
  const { campaign, setCampaignId, toast } = useApp()
  const state = useSync(campaign.syncCode)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinErr, setJoinErr] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const valid = normalizeCode(joinCode)

  const copy = async () => {
    const text = campaign.syncCode!
    try {
      if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) await navigator.share({ title: 'TableForge sync code', text: `TableForge sync code for "${campaign.name}": ${text}` })
      else { await navigator.clipboard.writeText(text); toast('Code copied') }
    } catch { /* user cancelled share */ }
  }

  const join = async () => {
    if (!valid) return
    setJoining(true); setJoinErr(null)
    try {
      const c = await joinCampaign(valid)
      setCampaignId(c.id!); setJoinCode('')
      toast(`Joined ${c.name}`)
    } catch (e) { setJoinErr(friendly(e)) } finally { setJoining(false) }
  }

  const statusLine = !state ? 'Connecting…'
    : state.status === 'live' ? `Connected to ${state.relaysUp} of ${state.relaysTotal} relays${state.pendingPush ? ` · sending ${state.pendingPush} change${state.pendingPush === 1 ? '' : 's'}` : ' · up to date'}`
      : state.status === 'offline' ? 'Offline — changes are saved here and will sync when you reconnect.'
        : 'Connecting to relays…'

  return (
    <Section title="Sync between devices">
      {campaign.syncCode ? (
        <>
          <div className="row">
            <span className={`sync-dot ${state?.status ?? 'connecting'}`} style={{ background: 'none', padding: 0 }}><i /></span>
            <span className="small">{statusLine}</span>
          </div>
          {state?.lastSync && <div className="muted tiny">Last synced {new Date(state.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>}
          <div className="muted small">Enter this code on the other phone or tablet (Settings → Sync → Join) to share <b>{campaign.name}</b>. Anyone with the code can see and edit this campaign, so only give it to your table.</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <code style={{ fontFamily: 'var(--ui)', fontSize: 20, fontWeight: 700, letterSpacing: '.06em', color: 'var(--gold)', background: 'var(--ink)', border: '1px solid var(--seam)', borderRadius: 12, padding: '10px 14px', userSelect: 'all' }}>{campaign.syncCode}</code>
            <button className="btn tonal" onClick={copy}><Icon n="copy" s={18} />Share code</button>
          </div>
          <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setStopping(true)}>Stop syncing on this device</button>
        </>
      ) : (
        <>
          <div className="muted small">Keep <b>{campaign.name}</b> in step between your devices — e.g. the DM's tablet and a player's phone. No account needed; data is encrypted on the device before it's sent.</div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={async () => { await linkCampaign(campaign); toast('Sync code created') }}><Icon n="sync" s={18} />Sync this campaign</button>
        </>
      )}
      <div style={{ borderTop: '1px solid var(--seam-soft)', margin: '6px 0 0', paddingTop: 14 }} className="stack">
        <div className="title-s">Join a campaign from another device</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '1 1 240px', fontFamily: 'var(--ui)', letterSpacing: '.05em', textTransform: 'uppercase' }} placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            value={joinCode} onChange={(e) => { setJoinCode(e.target.value); setJoinErr(null) }} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          <button className="btn primary" disabled={!valid || joining} onClick={join}>{joining ? <><span className="spinner" />Looking…</> : 'Join'}</button>
        </div>
        {joinCode && !valid && <div className="muted tiny">Codes are 20 letters and numbers, like ABCDE-23456-FGHJK-789MN.</div>}
        {joinErr && <div className="err small">{joinErr}</div>}
      </div>
      {stopping && <Confirm title="Stop syncing?" body="This device keeps its copy of the campaign but stops sending and receiving changes. Other devices aren't affected." action="Stop syncing"
        onConfirm={() => unlinkCampaign(campaign)} onClose={() => setStopping(false)} />}
    </Section>
  )
}

function AiCard() {
  const saved = useAi()
  const [d, setD] = useState<AiSettings>(saved)
  const [show, setShow] = useState(false)
  const [test, setTest] = useState<string | null>(null)
  useEffect(() => { setD(saved) }, [saved])
  const dirty = JSON.stringify(d) !== JSON.stringify(saved)

  const runTest = async () => {
    setTest('Testing…')
    try {
      const r = await complete(d, 'Reply with JSON only.', 'Reply with {"ok":true}', 30)
      setTest(r ? 'Connected — ready to forge.' : 'Connected, but the reply was empty.')
    } catch (e) { setTest('Failed: ' + friendly(e)) }
  }

  return (
    <Section title="AI generation">
      <div className="muted small">The Forge, story suggestions, table generation and map building use this. Offline mode uses built-in tables and needs no internet.</div>
      <Seg value={d.provider} onChange={(provider) => setD({ ...d, provider })} options={[{ value: 'OFFLINE', label: 'Offline' }, { value: 'CLAUDE', label: 'Claude' }]} />
      {d.provider === 'CLAUDE' && (
        <>
          <label className="field">
            <span>Claude API key</span>
            <div className="row">
              <input className="input grow" type={show ? 'text' : 'password'} value={d.claudeKey} placeholder="sk-ant-…" autoComplete="off" spellCheck={false}
                onChange={(e) => setD({ ...d, claudeKey: e.target.value.trim() })} />
              <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide key' : 'Show key'}><Icon n="eye" /></button>
            </div>
          </label>
          <Field label="Model" value={d.claudeModel} onChange={(claudeModel) => setD({ ...d, claudeModel })} placeholder={DEFAULT_MODEL} />
          <div className="muted tiny">Get a key at console.anthropic.com → API Keys. It's stored only on this device and sent only to Anthropic. Each device needs the key entered once (it isn't synced).</div>
          <label className="field"><span>Creativity: {d.creativity.toFixed(1)}</span>
            <input type="range" min={0.2} max={1} step={0.1} value={d.creativity} onChange={(e) => setD({ ...d, creativity: Number(e.target.value) })} />
          </label>
        </>
      )}
      <div className="row">
        <button className="btn primary" disabled={!dirty} onClick={() => saveAi(d)}>{dirty ? 'Save' : 'Saved'}</button>
        {d.provider === 'CLAUDE' && <button className="btn outline" disabled={!d.claudeKey} onClick={runTest}>Test connection</button>}
      </div>
      {test && <div className={test.startsWith('Failed') ? 'err small' : 'small'} style={test.startsWith('Failed') ? undefined : { color: 'var(--moss)' }}>{test}</div>}
    </Section>
  )
}

function InstallCard() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
  if (standalone) return null
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  return (
    <Section title="Install on this device">
      <div className="small">
        {ios
          ? <>In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>. TableForge then opens full-screen like an app and works offline. Set it up from the home-screen icon, since iPhone keeps that copy's data separate from Safari's.</>
          : <>In Chrome, open the <b>⋮</b> menu and choose <b>Add to Home screen</b> (or <b>Install app</b>). TableForge then opens full-screen like an app and works offline.</>}
      </div>
    </Section>
  )
}

function CampaignCard() {
  const { campaign } = useApp()
  const count = useLiveQuery(() => db.campaigns.count(), []) ?? 1
  const [deleting, setDeleting] = useState(false)
  return (
    <Section title="Campaign">
      <div className="title">{campaign.name}</div>
      <div className="muted small">Edit the name, overall plot, setting and tone from the Story tab. Switch or create campaigns from the bar at the top.</div>
      <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => setDeleting(true)}>Delete this campaign from this device…</button>
      {deleting && <Confirm title={`Delete ${campaign.name}?`}
        body={`Its ideas, outline, party, concepts and maps will be deleted from this device.${campaign.syncCode ? ' Other synced devices keep their copy.' : ''}${count <= 1 ? ' A fresh empty campaign will be created.' : ''}`}
        onConfirm={async () => { if (campaign.syncCode) await unlinkCampaign(campaign); await deleteCampaignCascade(campaign) }} onClose={() => setDeleting(false)} />}
    </Section>
  )
}

function AboutCard() {
  return (
    <Section title="About">
      <div className="title-s">TableForge for the web</div>
      <div className="muted small">
        Session prep for Dungeon Masters. Visual style inspired by Jack Lockwood's Quest Journal theme, the Rathgar Gold TTRPG theme, and Samantha Hersom's Pocket Squire concept.
        Fonts: Cinzel (Natanael Gama) and Crimson Text (Sebastian Kosch), SIL Open Font License. Sync uses public Nostr relays.{' '}
        <a href="https://github.com/Jondude1/TableForge-web/blob/main/CREDITS.md" target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>Full credits</a>.
      </div>
    </Section>
  )
}
