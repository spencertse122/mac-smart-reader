import { useState } from 'react'
import { ChevronLeft, Highlighter, List, NotebookPen, Type } from 'lucide-react'
import { ReaderSettingsMenu } from './ReaderSettingsMenu'
import { useIsMobile } from '../components/useIsMobile'
import { PomodoroControl } from '../pomodoro/PomodoroProvider'
import { KnowledgeRate } from '../stats/KnowledgeRate'

export function ReaderToolbar({ title, chapter, onBack, onToc, onNote, onHighlights, tocOpen = false, onMenuChange }: {
  title: string
  chapter: string
  onBack(): void
  onToc(): void
  onNote(): void
  onHighlights?(): void
  tocOpen?: boolean
  onMenuChange?(open: boolean): void
}) {
  const mobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const setMenu = (open: boolean): void => {
    setMenuOpen(open)
    onMenuChange?.(open)
  }
  return (
    <header className="reader-toolbar">
      <div className="reader-toolbar-side">
        <button className="reader-tool reader-back" onClick={onBack} data-testid="reader-back" title="Back to Library" aria-label={mobile ? 'Back to Library' : undefined}>
          <ChevronLeft size={mobile ? 24 : 18} />
          {!mobile && <span>Library</span>}
        </button>
      </div>
      <div className="reader-title" title={title}>
        <span className="reader-title-book">{title}</span>
        {chapter && <span className="reader-title-chapter">{chapter}</span>}
      </div>
      <div className="reader-toolbar-side end">
        <button className={`reader-tool icon ${tocOpen ? 'active' : ''}`} onClick={onToc} data-testid="reader-toc" title="Contents" aria-label="Contents">
          <List size={mobile ? 21 : 17} />
        </button>
        {onHighlights && (
          <button className="reader-tool icon" onClick={onHighlights} data-testid="open-highlights" title="Highlights" aria-label="Highlights">
            <Highlighter size={mobile ? 21 : 17} />
          </button>
        )}
        <button className="reader-tool icon" onClick={onNote} data-testid="reader-note" title="New note (⇧⌘N)" aria-label="New note">
          <NotebookPen size={mobile ? 21 : 17} />
        </button>
        <div className="reader-menu-anchor">
          <button
            className={`reader-tool icon ${menuOpen ? 'active' : ''}`}
            onClick={() => setMenu(!menuOpen)}
            data-testid="reader-settings"
            title="Appearance"
            aria-label="Appearance"
            aria-expanded={menuOpen}
          >
            <Type size={mobile ? 21 : 17} />
          </button>
          {menuOpen && <ReaderSettingsMenu onClose={() => setMenu(false)} />}
        </div>
      </div>
      {mobile && (
        <div className="reader-toolbar-status">
          <PomodoroControl />
          <KnowledgeRate />
        </div>
      )}
    </header>
  )
}
