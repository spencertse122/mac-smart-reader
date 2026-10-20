import { useState } from 'react'
import { ChevronLeft, List, Type } from 'lucide-react'
import { ReaderSettingsMenu } from './ReaderSettingsMenu'

export function ReaderToolbar({ title, chapter, onBack, onToc, tocOpen = false, onMenuChange }: {
  title: string
  chapter: string
  onBack(): void
  onToc(): void
  tocOpen?: boolean
  onMenuChange?(open: boolean): void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const setMenu = (open: boolean): void => {
    setMenuOpen(open)
    onMenuChange?.(open)
  }
  return (
    <header className="reader-toolbar">
      <div className="reader-toolbar-side">
        <button className="reader-tool reader-back" onClick={onBack} data-testid="reader-back" title="Back to Library">
          <ChevronLeft size={18} />
          <span>Library</span>
        </button>
      </div>
      <div className="reader-title" title={title}>
        <span className="reader-title-book">{title}</span>
        {chapter && <span className="reader-title-chapter">{chapter}</span>}
      </div>
      <div className="reader-toolbar-side end">
        <button className={`reader-tool icon ${tocOpen ? 'active' : ''}`} onClick={onToc} data-testid="reader-toc" title="Contents" aria-label="Contents">
          <List size={17} />
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
            <Type size={17} />
          </button>
          {menuOpen && <ReaderSettingsMenu onClose={() => setMenu(false)} />}
        </div>
      </div>
    </header>
  )
}
