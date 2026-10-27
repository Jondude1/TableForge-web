import { db, newUid, remove, save, type SharedKeyRow } from './db'
import { getAi, saveAi } from './settings'

/** Uids of shared-key records created on this device (so we never "receive" our own). */
const MINE = 'tf.ai.mine'
const mine = (): string[] => { try { return JSON.parse(localStorage.getItem(MINE) || '[]') } catch { return [] } }
const setMine = (l: string[]) => { try { localStorage.setItem(MINE, JSON.stringify(l)) } catch { /* ignore */ } }
export const isMine = (r: SharedKeyRow) => mine().includes(r.uid)

/** Starts sharing this device's Claude key with everyone synced to the campaign. */
export async function shareKey(campaignId: number, campaignName: string) {
  const ai = getAi()
  const existing = await db.sharedKeys.where('campaignId').equals(campaignId).first()
  // Claim ownership before saving, so the UI never sees our own record as "received".
  const uid = existing?.uid || newUid()
  setMine([...new Set([...mine(), uid])])
  await save(db.sharedKeys, {
    ...(existing ?? { updatedAt: 0 }),
    uid, campaignId, claudeKey: ai.claudeKey, claudeModel: ai.claudeModel, sharedBy: campaignName,
  })
}

export async function stopSharing(campaignId: number) {
  const rows = await db.sharedKeys.where('campaignId').equals(campaignId).toArray()
  for (const r of rows) if (isMine(r)) await remove(db.sharedKeys, r)
}

/** Keeps shared copies current when the owner changes their key or model. */
export async function refreshMyShares() {
  const ai = getAi()
  const rows = (await db.sharedKeys.toArray()).filter(isMine)
  for (const r of rows) {
    if (r.claudeKey !== ai.claudeKey || r.claudeModel !== ai.claudeModel) await save(db.sharedKeys, { ...r, claudeKey: ai.claudeKey, claudeModel: ai.claudeModel })
  }
}

/**
 * Applies a key shared by another device. A key typed on this device always wins;
 * a received key is removed again if the owner stops sharing.
 */
export function applySharedKeys(rows: SharedKeyRow[]) {
  const ai = getAi()
  const theirs = rows.filter((r) => !isMine(r) && r.claudeKey)
  const typedHere = ai.claudeKey && !ai.sharedFrom
  if (typedHere) return
  const r = theirs[0]
  if (r) {
    if (ai.claudeKey !== r.claudeKey || ai.claudeModel !== r.claudeModel || ai.provider !== 'CLAUDE' || ai.sharedFrom !== r.sharedBy) {
      saveAi({ ...ai, provider: 'CLAUDE', claudeKey: r.claudeKey, claudeModel: r.claudeModel, sharedFrom: r.sharedBy })
    }
  } else if (ai.sharedFrom) {
    saveAi({ ...ai, provider: 'OFFLINE', claudeKey: '', sharedFrom: undefined })
  }
}
