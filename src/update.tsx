import { useEffect, useState } from 'react'

/** The build's main script, e.g. /TableForge-web/assets/index-AbC123.js. Each deploy gets a new name. */
const currentScript = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src') ?? null

async function newerBuildExists(): Promise<boolean> {
  const mine = currentScript()
  if (!mine) return false // dev server
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?check=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const m = /src="([^"]*\/assets\/index-[^"]+\.js)"/.exec(await res.text())
    return !!m && m[1] !== mine
  } catch {
    return false // offline
  }
}

/** Shows a "new version" bar when a newer deploy is live; checks on open, on return to the app, and every 15 minutes. */
export function UpdateBar() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let last = 0
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return
      last = Date.now()
      void newerBuildExists().then((yes) => { if (yes) setReady(true) })
    }
    check()
    const t = setInterval(check, 15 * 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [])
  if (!ready) return null
  return (
    <div className="update-bar" role="status">
      <span className="grow">A new version of TableForge is ready.</span>
      <button className="btn primary sm" onClick={async () => {
        const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
        await reg?.update().catch(() => {})
        location.reload()
      }}>Reload</button>
      <button className="btn ghost sm" onClick={() => setReady(false)}>Later</button>
    </div>
  )
}
