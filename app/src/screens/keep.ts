import { useCallback, useEffect, useState } from 'react'

/** State that survives switching tabs (kept in memory for the session). */
const memory = new Map<string, unknown>()

export function useKept<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : init))
  // When the key changes (e.g. switching idea type), load that key's value.
  useEffect(() => { setV(memory.has(key) ? (memory.get(key) as T) : init) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((nv: T) => { memory.set(key, nv); setV(nv) }, [key])
  return [v, set]
}
