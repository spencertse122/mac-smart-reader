import { useCallback, useEffect, useState } from 'react'
import { NotebookPen, Pencil, Trash2 } from 'lucide-react'
import type { Highlight } from '../../../shared/types'
import { emitReader, onReader } from '../reader/bus'
import { useAppState } from '../state/appState'
import { toast } from '../state/actions'
import { lostAnchors } from '../reader/lostAnchors'
import '../reader/reader.css'

interface Group { chapter: string; items: Highlight[] }

function groupByChapter(list: Highlight[]): Group[] {
  const groups: Group[] = []
  for (const h of [...list].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))) {
    const chapter = h.chapter ?? ''
    const last = groups[groups.length - 1]
    if (last && last.chapter === chapter) last.items.push(h)
    else groups.push({ chapter, items: [h] })
  }
  return groups
}

function NoteItem({ h, bookId, onError }: { h: Highlight; bookId: string; onError(msg: string): void }) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState(h.note ?? '')
  const body = h.note ?? ''
  const long = body.length > 220 || body.split('\n').length > 4
  const save = async (): Promise<void> => {
    if (!text.trim()) return
    try {
      await window.api.highlights.update(bookId, h.id, { note: text.trim() })
      setEditing(false)
      emitReader('highlights-changed', { bookId })
    } catch (err) {
      onError(`Could not update note: ${(err as Error).message}`)
    }
  }
  const remove = async (): Promise<void> => {
    try {
      await window.api.highlights.remove(bookId, h.id)
      emitReader('highlights-changed', { bookId })
    } catch (err) {
      onError(`Could not delete note: ${(err as Error).message}`)
    }
  }
  return (
    <div className="hl-note-wrap" data-testid="note-item">
      {editing ? (
        <div className="hl-note-edit">
          <textarea
            autoFocus
            value={text}
            rows={4}
            data-testid="note-edit-input"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void save()
              } else if (e.key === 'Escape') {
                setEditing(false)
                setText(body)
              }
            }}
          />
          <div className="hl-note-tools">
            <button onClick={() => void save()} disabled={!text.trim()} data-testid="note-edit-save">Save</button>
            <button onClick={() => { setEditing(false); setText(body) }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          className="hl-item is-note"
          onClick={() => { if (h.location) emitReader('goto', { target: h.location }) }}
          title={h.location ? 'Go to where this note was written' : 'Note'}
          data-testid="hl-item"
        >
          <span className="hl-item-head"><NotebookPen size={12} /> Note</span>
          <span className={`hl-item-body ${long && !expanded ? 'clamped' : ''}`}>{body}</span>
        </button>
      )}
      {!editing && (
        <div className="hl-note-tools">
          {long && <button onClick={() => setExpanded(x => !x)}>{expanded ? 'Show less' : 'Show more'}</button>}
          <button onClick={() => { setText(body); setEditing(true) }} title="Edit note" aria-label="Edit note" data-testid="note-edit"><Pencil size={11} /></button>
          <button className="danger" onClick={() => void remove()} title="Delete note" aria-label="Delete note" data-testid="note-delete"><Trash2 size={11} /></button>
        </div>
      )}
    </div>
  )
}

export function HighlightsPanel({ bookId }: { bookId: string }) {
  const { dispatch } = useAppState()
  const [list, setList] = useState<Highlight[] | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const all = await window.api.highlights.list(bookId)
      setList(all.filter(h => !h.deleted))
    } catch {
      setList([])
    }
  }, [bookId])

  useEffect(() => {
    void load()
    const offs = [
      onReader('highlights-changed', d => {
        if (d.bookId === bookId) void load()
      }),
      window.api.on.reviewChanged(() => void load())
    ]
    return () => offs.forEach(off => off())
  }, [bookId, load])

  if (list === null) return null
  if (list.length === 0) {
    return <p className="hl-panel-empty">No highlights or notes yet. Select text to highlight, or add a note.</p>
  }

  return (
    <div className="hl-panel" data-testid="highlights-panel">
      {groupByChapter(list).map((g, gi) => (
        <section key={`${gi}-${g.chapter}`} className="hl-group">
          {g.chapter && <h4 className="hl-group-title">{g.chapter}</h4>}
          {g.items.map(h => h.kind === 'note' ? (
            <NoteItem key={h.id} h={h} bookId={bookId} onError={m => toast(dispatch, 'error', m)} />
          ) : (
            <button
              key={h.id}
              className="hl-item"
              style={{ borderLeftColor: `var(--dot-${h.color})` }}
              onClick={() => emitReader('goto', { target: h.location })}
              title="Go to highlight"
              data-testid="hl-item"
            >
              <span className="hl-item-quote">{h.quote.exact.replace(/\s+/g, ' ').trim()}</span>
              {h.note && <span className="hl-item-note">{h.note}</span>}
              {lostAnchors.has(h.id) && <span className="hl-item-lost">location lost</span>}
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
