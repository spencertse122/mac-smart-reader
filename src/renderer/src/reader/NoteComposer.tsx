import { useState, type KeyboardEvent } from 'react'

export function NoteComposer({ onSave, onClose }: { onSave(text: string): void; onClose(): void }) {
  const [text, setText] = useState('')
  const empty = text.trim() === ''
  const save = (): void => {
    if (!empty) onSave(text.trim())
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    e.stopPropagation() // keep arrows, space etc. away from the reader's page turning
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }
  return (
    <div className="note-composer" role="dialog" aria-label="New note" data-testid="note-composer" onPointerDown={e => e.stopPropagation()}>
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Write a note…"
        rows={4}
        maxLength={5000}
        data-testid="note-input"
      />
      <div className="hl-note-actions">
        <span className="hl-hint">⌘↩ to save · Esc to cancel</span>
        <span className="note-composer-buttons">
          <button className="btn" onClick={onClose} data-testid="note-cancel">Cancel</button>
          <button className="btn btn-primary hl-save" onClick={save} disabled={empty} data-testid="note-save">Save</button>
        </span>
      </div>
    </div>
  )
}
