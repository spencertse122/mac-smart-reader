import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function BottomSheet({ open, onClose, title, children, testId }: {
  open: boolean
  onClose(): void
  title: string
  children: ReactNode
  testId?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // Portalled so the sheet sits above the tab bar and the reader's stacking contexts.
  return createPortal(
    <div className="sheet-root">
      <div className="sheet-scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-label={title} data-testid={testId ?? 'bottom-sheet'} onPointerDown={e => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <header className="sheet-head">
          <span className="sheet-title">{title}</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close" data-testid="sheet-close"><X size={18} /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>,
    document.body
  )
}
