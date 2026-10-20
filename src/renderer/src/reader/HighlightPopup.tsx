import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Copy, NotebookPen, Trash2 } from 'lucide-react'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../../../shared/types'

interface Common {
  rect: DOMRect
  onColor(c: HighlightColor): void
  onNote(note: string): void
}

export type PopupState =
  | (Common & { mode: 'new'; onCopy(): void })
  | (Common & { mode: 'edit'; highlight: Highlight; onDelete(): void })

const GAP = 10
const EDGE = 12

export function HighlightPopup({ state, onClose, onDraft }: { state: PopupState; onClose(): void; onDraft?(note: string): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const editNote = state.mode === 'edit' ? state.highlight.note ?? '' : ''
  const [noteOpen, setNoteOpen] = useState(editNote !== '')
  const [note, setNote] = useState(editNote)
  // Each popup is keyed, so this runs once per popup: the draft starts as the saved note.
  useLayoutEffect(() => onDraft?.(editNote), [])
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const current = state.mode === 'edit' ? state.highlight.color : null

  // Measure after render so the card can be centered on the selection and kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const r = state.rect
    const below = r.top < 80 + height
    const center = r.left + r.width / 2
    const left = Math.min(Math.max(EDGE, center - width / 2), window.innerWidth - width - EDGE)
    const top = below
      ? Math.min(r.bottom + GAP, window.innerHeight - height - EDGE)
      : r.top - height - GAP
    setPos({ left, top, below })
  }, [state.rect, noteOpen])

  const save = (): void => state.onNote(note.trim())
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      className={`hl-popup ${pos ? 'placed' : ''} ${pos?.below ? 'below' : 'above'}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      data-testid="hl-popup"
      role="dialog"
      aria-label={state.mode === 'new' ? 'Highlight selection' : 'Edit highlight'}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="hl-popup-row">
        {HIGHLIGHT_COLORS.map(c => (
          <button
            key={c}
            className={`hl-dot ${current === c ? 'current' : ''}`}
            style={{ background: `var(--dot-${c})` }}
            onClick={() => state.onColor(c)}
            title={c[0].toUpperCase() + c.slice(1)}
            aria-label={`Highlight ${c}`}
            data-testid={`hl-color-${c}`}
          />
        ))}
        <span className="hl-divider" />
        <button
          className={`hl-action ${noteOpen ? 'active' : ''}`}
          onClick={() => setNoteOpen(o => !o)}
          title="Note"
          aria-label="Note"
          data-testid="hl-note"
        >
          <NotebookPen size={16} />
        </button>
        {state.mode === 'new' ? (
          <button className="hl-action" onClick={state.onCopy} title="Copy" aria-label="Copy">
            <Copy size={16} />
          </button>
        ) : (
          <button className="hl-action danger" onClick={state.onDelete} title="Delete highlight" aria-label="Delete highlight" data-testid="hl-delete">
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {noteOpen && (
        <div className="hl-note">
          <textarea
            autoFocus
            value={note}
            onChange={e => {
              setNote(e.target.value)
              onDraft?.(e.target.value)
            }}
            onKeyDown={onKey}
            placeholder="Add a note…"
            rows={3}
            data-testid="hl-note-input"
          />
          <div className="hl-note-actions">
            <span className="hl-hint">⌘↩ to save</span>
            <button className="btn btn-primary hl-save" onClick={save} data-testid="hl-note-save">Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
