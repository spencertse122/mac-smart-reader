import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { VocabWord } from '../../../shared/types'
import { useAppState } from '../state/appState'
import { toast } from '../state/actions'
import { Emphasized } from '../vocab/Emphasized'
import '../vocab/vocab.css'

export function VocabView() {
  const { state, dispatch } = useAppState()
  const [words, setWords] = useState<VocabWord[] | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [zhOpen, setZhOpen] = useState<string | null>(null)

  const load = useCallback(() => { void window.api.vocab.list().then(setWords).catch(() => setWords([])) }, [])
  useEffect(() => {
    load()
    return window.api.on.reviewChanged(load)
  }, [load])

  const title = useMemo(() => new Map(state.books.map(b => [b.id, b.title])), [state.books])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (words ?? []).filter(w => !q || w.headword.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q) || (w.zh ?? '').toLowerCase().includes(q))
  }, [words, query])

  const remove = (id: string): void => {
    setConfirm(null)
    window.api.vocab.remove(id).then(load, (err: Error) => toast(dispatch, 'error', `Could not delete word: ${err.message}`))
  }
  const goto = (bookId: string, location: string): void => dispatch({ type: 'navigate', view: { name: 'reader', bookId, target: location } })

  return (
    <div className="vocab-view" data-testid="view-vocab">
      <div className="vocab-inner">
        <div className="vocab-top">
          <h1>Vocabulary</h1>
          {words && words.length > 0 && (
            <input className="vocab-search" type="search" placeholder="Search words" value={query} onChange={e => setQuery(e.target.value)} data-testid="vocab-search" />
          )}
        </div>
        {words === null ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : words.length === 0 ? (
          <div className="vocab-empty muted" data-testid="vocab-empty">Select a word while reading and choose Look Up — it'll be saved here and come back in Review.</div>
        ) : visible.length === 0 ? (
          <div className="vocab-empty muted">No words match “{query}”.</div>
        ) : (
          visible.map(w => {
            const newest = w.contexts[w.contexts.length - 1]
            const expanded = open === w.id
            return (
              <div key={w.id} className={`card vocab-item ${expanded ? 'open' : ''}`} data-testid="vocab-item">
                <div className="vocab-row">
                  <button className="vocab-main" onClick={() => setOpen(expanded ? null : w.id)} aria-expanded={expanded} data-testid="vocab-toggle">
                    <span className="vocab-head">
                      <b className="vocab-word" data-testid="vocab-headword">{w.headword}</b>
                      {w.pronunciation && <span className="muted">/{w.pronunciation}/</span>}
                      {w.zh && <span className="vocab-zh" data-testid="vocab-zh">{w.zh}</span>}
                    </span>
                    <span className={`vocab-def ${expanded ? 'full' : ''}`} data-testid="vocab-def">{w.definition}</span>
                    {!expanded && newest && (
                      <span className="vocab-ctx muted">
                        <Emphasized sentence={newest.sentence} terms={[w.headword]} />
                        {title.get(newest.bookId) ? ` — ${title.get(newest.bookId)}` : ''}
                      </span>
                    )}
                  </button>
                  {confirm === w.id ? (
                    <span className="vocab-confirm">
                      Delete?
                      <button className="btn btn-ghost" onClick={() => remove(w.id)} data-testid="vocab-delete-yes">Yes</button>
                      <button className="btn btn-ghost" onClick={() => setConfirm(null)} data-testid="vocab-delete-no">No</button>
                    </span>
                  ) : (
                    <button className="btn-ghost icon-btn vocab-del" title="Delete word" aria-label="Delete word" onClick={() => setConfirm(w.id)} data-testid="vocab-delete">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                {expanded && w.zhEntry && (
                  <div className="vocab-zhmore">
                    <button className="vocab-more" onClick={() => setZhOpen(zhOpen === w.id ? null : w.id)} aria-expanded={zhOpen === w.id} data-testid="vocab-zh-more">
                      {zhOpen === w.id ? 'Less' : 'More'}
                    </button>
                    {zhOpen === w.id && <div className="vocab-zhentry" data-testid="vocab-zh-entry">{w.zhEntry}</div>}
                  </div>
                )}
                {expanded && (
                  <div className="vocab-contexts">
                    {w.contexts.slice().reverse().map((c, i) => (
                      <button key={i} className="vocab-context" onClick={() => goto(c.bookId, c.location)} data-testid="vocab-context">
                        <span><Emphasized sentence={c.sentence} terms={[w.headword]} /></span>
                        <span className="muted">{title.get(c.bookId) ?? 'Unknown book'}{c.chapter ? ` · ${c.chapter}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
