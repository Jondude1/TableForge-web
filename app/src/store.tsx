import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureCampaign, onLocalChange, type CampaignRow } from './lib/db'
import type { Ctx } from './lib/forge'
import { loadNum, saveNum } from './lib/settings'
import { pushAllSoon, resumeAll } from './lib/sync'
import { applySharedKeys } from './lib/sharedkey'

interface App {
  campaignId: number
  campaign: CampaignRow
  setCampaignId: (id: number) => void
  toast: (msg: string) => void
  /** Snapshot of everything generators need to know about the campaign. */
  buildCtx: () => Promise<Ctx | null>
}

const AppCtx = createContext<App | null>(null)
export const useApp = () => useContext(AppCtx)!

export function AppProvider({ children }: { children: ReactNode }) {
  const [campaignId, setId] = useState<number | null>(() => loadNum('tf.campaign'))
  const [toastMsg, setToast] = useState<string | null>(null)
  const campaigns = useLiveQuery(() => db.campaigns.toArray(), [])
  const campaign = campaigns?.find((c) => c.id === campaignId)
  const sharedKeys = useLiveQuery(() => db.sharedKeys.toArray(), [])

  // Use a Claude key shared from another synced device (unless one was typed here).
  useEffect(() => { if (sharedKeys) applySharedKeys(sharedKeys) }, [sharedKeys])

  // Make sure there's always a valid current campaign.
  useEffect(() => {
    if (!campaigns) return
    if (campaigns.length === 0) { void ensureCampaign().then((id) => { setId(id); saveNum('tf.campaign', id) }); return }
    if (!campaigns.some((c) => c.id === campaignId)) { setId(campaigns[0].id!); saveNum('tf.campaign', campaigns[0].id!) }
  }, [campaigns, campaignId])

  useEffect(() => {
    void resumeAll()
    const off = onLocalChange(() => pushAllSoon())
    return () => { off() }
  }, [])

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toastMsg])

  const setCampaignId = useCallback((id: number) => { setId(id); saveNum('tf.campaign', id) }, [])

  const buildCtx = useCallback(async (): Promise<Ctx | null> => {
    if (campaignId == null) return null
    const c = await db.campaigns.get(campaignId)
    if (!c) return null
    const [beats, ideas, players] = await Promise.all([
      db.beats.where('campaignId').equals(campaignId).sortBy('position'),
      db.ideas.where('campaignId').equals(campaignId).toArray(),
      db.players.where('campaignId').equals(campaignId).toArray(),
    ])
    return { campaign: c, beats, ideas, players }
  }, [campaignId])

  const value = useMemo<App | null>(() => (campaignId != null && campaign
    ? { campaignId, campaign, setCampaignId, toast: setToast, buildCtx }
    : null), [campaignId, campaign, setCampaignId, buildCtx])

  if (!value) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><span className="spinner" style={{ color: 'var(--gold)' }} /></div>
  return (
    <AppCtx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </AppCtx.Provider>
  )
}
