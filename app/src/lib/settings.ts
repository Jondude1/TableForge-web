import { useSyncExternalStore } from 'react'

export type Provider = 'OFFLINE' | 'CLAUDE'
export const DEFAULT_MODEL = 'claude-sonnet-5-5'

export interface AiSettings {
  provider: Provider; claudeKey: string; claudeModel: string; creativity: number
  /** Set when the key was received from another device through sync (not typed here). */
  sharedFrom?: string
}

const KEY = 'tf.ai'
const defaults: AiSettings = { provider: 'OFFLINE', claudeKey: '', claudeModel: DEFAULT_MODEL, creativity: 0.9 }

function read(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults
  } catch {
    return defaults
  }
}

let current = read()
const subs = new Set<() => void>()

export function getAi() { return current }
export function saveAi(s: AiSettings) {
  current = { ...s, claudeKey: s.claudeKey.trim(), claudeModel: s.claudeModel.trim() || DEFAULT_MODEL }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* private mode */ }
  subs.forEach((f) => f())
}
export const aiReady = (s: AiSettings) => s.provider === 'CLAUDE' && s.claudeKey.length > 0

export function useAi(): AiSettings {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, getAi)
}

/** Small persisted value helper for UI state such as the current campaign. */
export function loadNum(key: string): number | null {
  try { const v = localStorage.getItem(key); return v == null ? null : Number(v) } catch { return null }
}
export function saveNum(key: string, v: number | null) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, String(v)) } catch { /* ignore */ }
}
