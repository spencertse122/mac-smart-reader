import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { FoliateTocItem } from './foliate'

export function TocDrawer({ toc, current, onPick, onClose }: {
  toc: FoliateTocItem[]
  current?: string
  onPick(href: string): void
  onClose(): void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const render = (items: FoliateTocItem[], level: number) =>
    items.map((item, i) => (
      <li key={`${level}-${i}-${item.href}`}>
        <button
          className={`toc-item ${current && item.label === current ? 'current' : ''}`}
          style={{ paddingLeft: 16 + level * 14 }}
          onClick={() => onPick(item.href)}
          data-testid="toc-item"
        >
          {item.label.trim() || 'Untitled'}
        </button>
        {item.subitems?.length ? <ul>{render(item.subitems, level + 1)}</ul> : null}
      </li>
    ))

  return (
    <>
      <div className="toc-scrim" onClick={onClose} />
      <nav className="toc-drawer" aria-label="Table of contents" data-testid="toc-drawer">
        <div className="toc-head">
          <span>Contents</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close contents"><X size={15} /></button>
        </div>
        {toc.length ? <ul className="toc-list">{render(toc, 0)}</ul> : <p className="toc-empty">This book has no table of contents.</p>}
      </nav>
    </>
  )
}
