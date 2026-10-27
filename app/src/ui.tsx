import { useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { IDEA_TYPES, asType, cap, type IdeaType } from './lib/types'

// ---------- Icons (simple strokes, Material-style geometry) ----------

const P: Record<string, string> = {
  forge: 'M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9zM6 15l.7 1.6L8.3 17l-1.6.7L6 19.3l-.7-1.6L3.7 17l1.6-.4z',
  story: 'M4 5.5C6.5 4.5 9.3 4.5 12 6c2.7-1.5 5.5-1.5 8-.5v13c-2.5-1-5.3-1-8 .5-2.7-1.5-5.5-1.5-8-.5zM12 6v13.5',
  ideas: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  concepts: 'M5 6h5v4H5zM14 14h5v4h-5zM14 4h5v4h-5zM10 8h4M7.5 10v4.5a1.5 1.5 0 0 0 1.5 1.5h5',
  maps: 'M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20',
  loot: 'M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 6 3-6M12 9v12',
  tables: 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5zM12 7l4.5 8h-9zM12 2.5V7M20.2 7.25L16.5 15M3.8 7.25L7.5 15M12 21.5l4.5-6.5M12 21.5L7.5 15',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v8',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  check: 'M5 12l5 5L20 7',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  send: 'M4 12L20 4l-6 16-3-7zM11 13l9-9',
  brush: 'M14 4l6 6-8 8c-1 1-2.5 1-3.5 0L6.5 16c-1-1-1-2.5 0-3.5zM6.5 16L3 20h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M6 9l6 6 6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  sync: 'M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.7L4 16M4 20v-4h4',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  touch: 'M9 11V5a1.5 1.5 0 0 1 3 0v5m0 0V8.5a1.5 1.5 0 0 1 3 0V11m0 0a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.6 15a1.5 1.5 0 0 1 2.5-1.7L9 16',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7',
  chest: 'M3 10h18v10H3zM3 10a6 5 0 0 1 18 0M11 13h2v3h-2z',
  monster: 'M12 3c-4.4 0-8 3.1-8 7.5 0 2.6 1.3 4.6 3 5.8V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2.7c1.7-1.2 3-3.2 3-5.8C20 6.1 16.4 3 12 3zM9 11.5h.01M15 11.5h.01M10.5 21v-3M13.5 21v-3M10 15.5l2-1.5 2 1.5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
}

export function Icon({ n, s = 22, fill, style }: { n: keyof typeof P | string; s?: number; fill?: boolean; style?: CSSProperties }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d={P[n] ?? P.more} />
    </svg>
  )
}

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 108 108" aria-label="TableForge">
      <g fill="none" stroke="#D4A84B" strokeLinejoin="round">
        <path strokeWidth="4.5" d="M54,22 L80.5,37 L80.5,71 L54,86 L27.5,71 L27.5,37 Z" />
        <path strokeWidth="3" d="M54,32 L72,64 L36,64 Z M54,22 L54,32 M80.5,37 L54,32 M27.5,37 L54,32 M80.5,71 L72,64 M27.5,71 L36,64 M54,86 L72,64 M54,86 L36,64 M80.5,37 L72,64 M27.5,37 L36,64" />
      </g>
    </svg>
  )
}

// ---------- Small pieces ----------

export function Header({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="header">
      <div className="grow">
        <h1 className="h1">{title}</h1>
        <div className="rule" />
        {sub && <div className="muted small">{sub}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  )
}

export const Label = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <div className="label" style={style}>{children}</div>

export function TypeTag({ type }: { type: string }) {
  const t = IDEA_TYPES[asType(type)]
  return <span className="tag" style={{ color: t.color, background: `${t.color}24` }}><i style={{ background: t.color }} />{cap(t.singular)}</span>
}

export const PillO = ({ text, color }: { text: string; color: string }) => <span className="pill-o" style={{ color, borderColor: `${color}80` }}>{text}</span>

/** Renders "Label: text" lines with the label emphasized. */
export function LabeledBody({ body, max }: { body: string; max?: number }) {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const shown = max ? lines.slice(0, max) : lines
  return (
    <dl className="lb">
      {shown.map((line, i) => {
        const idx = line.indexOf(':')
        return idx > 0 && idx <= 28
          ? [<dt key={`t${i}`}>{line.slice(0, idx)}</dt>, <dd key={`d${i}`}>{line.slice(idx + 1).trim()}</dd>]
          : <dd key={i} className="full">{line.replace(/^- /, '')}</dd>
      })}
      {max && lines.length > max && <dd className="full muted">…</dd>}
    </dl>
  )
}

export function Empty({ icon, title, body, children }: { icon: string; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon n={icon} s={46} />
      <h2 className="title">{title}</h2>
      <p className="muted small">{body}</p>
      {children}
    </div>
  )
}

export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-modal>
        <div className="d-head"><h2 className="h2">{title}</h2></div>
        <div className="d-body">{children}</div>
        {footer && <div className="d-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Form dialog with Save / Cancel and an optional left-side action (usually Delete). */
export function FormModal({ title, onClose, onSave, canSave = true, left, children, saveLabel = 'Save' }: {
  title: string; onClose: () => void; onSave: () => void; canSave?: boolean; left?: ReactNode; children: ReactNode; saveLabel?: string
}) {
  return (
    <Modal title={title} onClose={onClose} footer={<>
      {left}<div className="grow" />
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!canSave} onClick={onSave}>{saveLabel}</button>
    </>}>
      {children}
    </Modal>
  )
}

export function Confirm({ title, body, action = 'Delete', onConfirm, onClose }: { title: string; body: string; action?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn danger" onClick={() => { onConfirm(); onClose() }}>{action}</button>
    </>}>
      <p style={{ margin: 0 }}>{body}</p>
    </Modal>
  )
}

export function Field({ label, value, onChange, multi, rows = 3, placeholder, type = 'text', autoFocus }: {
  label?: string; value: string; onChange: (v: string) => void; multi?: boolean; rows?: number; placeholder?: string; type?: string; autoFocus?: boolean
}) {
  return (
    <label className="field">
      {label && <span>{label}</span>}
      {multi
        ? <textarea className="textarea" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
        : <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} autoCapitalize="sentences" />}
    </label>
  )
}

export function Select<T extends string | number>({ label, value, options, onChange }: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      {label && <span>{label}</span>}
      <select className="select" value={String(value)} onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value)
        if (o) onChange(o.value)
      }}>
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>{o.label}</button>)}
    </div>
  )
}

export function Die({ label, size = 46, filled, onClick, spin }: { label: string; size?: number; filled?: boolean; onClick?: () => void; spin?: number }) {
  return (
    <button key={spin} className={`die${filled ? ' filled' : ''}${spin ? ' spin' : ''}`} style={{ '--s': `${size}px` } as CSSProperties} onClick={onClick} aria-label={label}>
      <span>{label}</span>
    </button>
  )
}

export const ErrorBanner = ({ msg }: { msg: string }) => <div className="banner">{msg}</div>

export function useWide(min = 760) {
  const [wide, setWide] = useState(() => window.matchMedia(`(min-width: ${min}px)`).matches)
  useEffect(() => {
    const m = window.matchMedia(`(min-width: ${min}px)`)
    const f = () => setWide(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [min])
  return wide
}

export const typeOptions = (types: IdeaType[]) => types.map((t) => ({ value: t, label: cap(IDEA_TYPES[t].singular) }))
