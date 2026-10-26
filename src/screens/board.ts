import { useCallback, useRef, useState } from 'react'

export interface View { scale: number; x: number; y: number }

/**
 * Pan and pinch-zoom for a board, using pointer events (works with touch, pen and mouse).
 * The caller decides what a one-finger gesture means; two fingers always pan + zoom,
 * and the mouse wheel zooms around the cursor.
 */
export function useView(init: View, min = 0.25, max = 4) {
  const [view, setView] = useState<View>(init)
  const viewRef = useRef(view)
  viewRef.current = view
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null)

  const apply = useCallback((v: View) => { viewRef.current = v; setView(v) }, [])

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    const v = viewRef.current
    const s = Math.min(max, Math.max(min, v.scale * factor))
    const f = s / v.scale
    apply({ scale: s, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f })
  }, [apply, min, max])

  /** Screen point (relative to board) -> content coordinates. */
  const toContent = useCallback((px: number, py: number) => {
    const v = viewRef.current
    return { x: (px - v.x) / v.scale, y: (py - v.y) / v.scale }
  }, [])

  /** Track a pointer. Returns true when two or more pointers are down (pinch in progress). */
  const down = (id: number, x: number, y: number) => {
    pointers.current.set(id, { x, y })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
    }
    return pointers.current.size >= 2
  }
  const move = (id: number, x: number, y: number) => {
    if (!pointers.current.has(id)) return false
    pointers.current.set(id, { x, y })
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
      const v = viewRef.current
      apply({ ...v, x: v.x + (cx - pinch.current.cx), y: v.y + (cy - pinch.current.cy) })
      if (pinch.current.dist > 0) zoomAt(cx, cy, dist / pinch.current.dist)
      pinch.current = { dist, cx, cy }
      return true
    }
    return false
  }
  const up = (id: number) => {
    pointers.current.delete(id)
    if (pointers.current.size < 2) pinch.current = null
    return pointers.current.size
  }
  const panBy = (dx: number, dy: number) => { const v = viewRef.current; apply({ ...v, x: v.x + dx, y: v.y + dy }) }

  return { view, setView: apply, zoomAt, toContent, down, move, up, panBy, pointerCount: () => pointers.current.size }
}
