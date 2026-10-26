// Minimal Nostr relay for local testing (NIP-01 subset + parameterized replaceable events).
import { WebSocketServer } from 'ws'
const port = Number(process.env.PORT || 7777)
const wss = new WebSocketServer({ port })
const events = new Map() // key -> event
const subs = new Set()   // {ws, id, filters}
const keyOf = (e) => (e.kind >= 30000 && e.kind < 40000) ? `${e.pubkey}:${e.kind}:${(e.tags.find(t => t[0] === 'd') || [])[1] || ''}` : e.id
const match = (e, f) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) &&
  (!f['#t'] || e.tags.some(t => t[0] === 't' && f['#t'].includes(t[1]))) && (!f.since || e.created_at >= f.since)
let received = 0
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw) } catch { return }
    if (m[0] === 'EVENT') {
      const e = m[1]; received++
      const k = keyOf(e), prev = events.get(k)
      const accept = !prev || e.created_at > prev.created_at || (e.created_at === prev.created_at && e.id < prev.id)
      if (accept) {
        events.set(k, e)
        for (const s of subs) if (s.filters.some(f => match(e, f)) && s.ws.readyState === 1) s.ws.send(JSON.stringify(['EVENT', s.id, e]))
      }
      ws.send(JSON.stringify(['OK', e.id, true, accept ? '' : 'duplicate: older']))
    } else if (m[0] === 'REQ') {
      const [, id, ...filters] = m
      subs.add({ ws, id, filters })
      for (const e of events.values()) if (filters.some(f => match(e, f))) ws.send(JSON.stringify(['EVENT', id, e]))
      ws.send(JSON.stringify(['EOSE', id]))
    } else if (m[0] === 'CLOSE') {
      for (const s of subs) if (s.ws === ws && s.id === m[1]) subs.delete(s)
    }
  })
  ws.on('close', () => { for (const s of subs) if (s.ws === ws) subs.delete(s) })
})
setInterval(() => process.stdout.write(`relay: ${events.size} stored, ${received} received\n`), 5000).unref?.()
console.log('relay on', port)
