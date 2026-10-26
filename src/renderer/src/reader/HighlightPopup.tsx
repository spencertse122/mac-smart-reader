import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { BookA, Copy, NotebookPen, Trash2 } from 'lucide-react'
import { HIGHLIGHT_COLORS, type DictEntry, type Highlight, type HighlightColor, type ZhResult } from '../../../shared/types'
import { Emphasized } from '../vocab/Emphasized'

interface Common {
  rect: DOMRect
  onColor(c: HighlightColor): void
  onNote(note: string): void
}

export type LookUpOutcome =
  | { ok: true; entry: DictEntry; zh: ZhResult; sentence: string; saved: boolean }
  | { ok: false; reason: 'not-found' | 'unavailable' }

export type PopupState =
  | (Common & { mode: 'new'; onCopy(): void; term: string | null; onLookUp(): Promise<LookUpOutcome> })
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
  const [look, setLook] = useState<'idle' | 'busy' | LookUpOutcome>('idle')
  const [zhMore, setZhMore] = useState(false)
  const lookTerm = state.mode === 'new' ? state.term : null
  const runLookUp = (): void => {
    if (state.mode !== 'new' || look === 'busy') return
    setLook('busy')
    setZhMore(false)
    state.onLookUp().then(setLook, () => setLook({ ok: false, reason: 'unavailable' }))
  }
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
  }, [state.rect, noteOpen, look])

  const save = (): void => state.onNote(note.trim())
  // Keys typed in the popup must never reach page turning.
  const stopKeys = (e: KeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    if (e.key === 'Escape') onClose()
  }
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
      onKeyDown={stopKeys}
      onKeyUp={e => e.stopPropagation()}
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
        {state.mode === 'new' && (
          <button
            className={`hl-action ${look !== 'idle' ? 'active' : ''}`}
            onClick={runLookUp}
            disabled={!lookTerm}
            title={lookTerm ? 'Look Up' : 'Select a word or short phrase to look up'}
            aria-label="Look Up"
            data-testid="hl-lookup"
          >
            <BookA size={16} />
          </button>
        )}
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
      {look !== 'idle' && (
        <div className="hl-lookup" data-testid="hl-lookup-result">
          {look === 'busy' ? (
            <div className="muted">Looking up…</div>
          ) : look.ok ? (
            <>
              <div className="hl-lookup-head">
                <b data-testid="hl-lookup-headword">{look.entry.headword}</b>
                {look.entry.pronunciation && <span className="muted">/{look.entry.pronunciation}/</span>}
              </div>
              {look.zh.status === 'ok' && (
                <div className="hl-lookup-zhwrap">
                  <div className="hl-lookup-zh" data-testid="lookup-zh">{look.zh.gloss}</div>
                  <button className="hl-lookup-more" onClick={() => setZhMore(m => !m)} aria-expanded={zhMore} data-testid="lookup-zh-more">{zhMore ? 'Less' : 'More'}</button>
                </div>
              )}
              {look.zh.status === 'ok' && zhMore && <div className="hl-lookup-zhentry" data-testid="lookup-zh-entry">{look.zh.entry}</div>}
              {look.zh.status === 'unavailable' && (
                <div className="hl-lookup-hint muted" data-testid="lookup-zh-hint">For Chinese, turn on 'Simplified Chinese – English' in Dictionary → Settings.</div>
              )}
              <div className="hl-lookup-def" data-testid="hl-lookup-def">{look.entry.text}</div>
              {look.sentence && (
                <div className="hl-lookup-sentence muted">
                  <Emphasized sentence={look.sentence} terms={[look.entry.headword, lookTerm]} />
                </div>
              )}
              {look.saved && <div className="hl-lookup-saved" data-testid="hl-lookup-saved">Saved to Vocabulary</div>}
            </>
          ) : look.reason === 'not-found' ? (
            <div className="muted" data-testid="hl-lookup-msg">No definition found for “{lookTerm}”.</div>
          ) : (
            <div className="muted" data-testid="hl-lookup-msg">Dictionary isn't available. Open the Dictionary app once so macOS downloads it.</div>
          )}
        </div>
      )}
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
