import { useCallback, useEffect, useState } from 'react'
import type { Highlight } from '../../../shared/types'
import { emitReader, onReader } from '../reader/bus'
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

export function HighlightsPanel({ bookId }: { bookId: string }) {
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
    return <p className="hl-panel-empty">No highlights yet. Select text to highlight.</p>
  }

  return (
    <div className="hl-panel" data-testid="highlights-panel">
      {groupByChapter(list).map((g, gi) => (
        <section key={`${gi}-${g.chapter}`} className="hl-group">
          {g.chapter && <h4 className="hl-group-title">{g.chapter}</h4>}
          {g.items.map(h => (
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
