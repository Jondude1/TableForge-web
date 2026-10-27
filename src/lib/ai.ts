import type { AiSettings } from './settings'
import { DEFAULT_MODEL } from './settings'

export class AiError extends Error {}

/** Calls Claude directly from the browser with the user's own key. */
/** An image to send alongside the prompt (base64 without the data: prefix). */
export interface ImagePart { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }

export async function complete(s: AiSettings, system: string, user: string, maxTokens = 3000, images: ImagePart[] = []): Promise<string> {
  if (s.provider !== 'CLAUDE') throw new AiError('Offline mode has no AI model. Add a Claude API key in Settings.')
  if (!s.claudeKey) throw new AiError('Add your Claude API key in Settings.')
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: s.claudeModel || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{
          role: 'user',
          content: images.length
            ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })), { type: 'text', text: user }]
            : user,
        }],
      }),
    })
  } catch {
    throw new AiError("Can't reach Claude. Check the internet connection.")
  }
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 200)
    try { msg = JSON.parse(text)?.error?.message || msg } catch { /* keep raw */ }
    if (res.status === 401) msg = 'The API key was rejected. Check it in Settings.'
    if (res.status === 429) msg = 'Claude is rate-limiting this key. Wait a moment and try again.'
    throw new AiError(`Claude error ${res.status}: ${msg}`)
  }
  const json = JSON.parse(text)
  return (json.content ?? []).filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('')
}

/** Pulls a JSON object out of a reply, tolerating code fences and stray prose. */
export function parseObject(raw: string): Record<string, unknown> {
  const t = raw.replace(/```json/g, '').replace(/```/g, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new AiError("The answer wasn't in the expected format. Try again.")
  try { return JSON.parse(t.slice(a, b + 1)) } catch { throw new AiError("The answer wasn't in the expected format. Try again.") }
}

export const friendly = (e: unknown) => (e instanceof Error ? e.message : String(e))
