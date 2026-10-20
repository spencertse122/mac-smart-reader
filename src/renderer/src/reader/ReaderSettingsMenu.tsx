import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import type { ReaderTheme, Settings } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { useAppState } from '../state/appState'
import { updateSettings } from '../state/actions'
import { READER_THEMES } from './readerStyles'

const LINE_HEIGHTS = [1.35, 1.55, 1.8]
const MIN_SIZE = 14
const MAX_SIZE = 28

export function ReaderSettingsMenu({ onClose }: { onClose(): void }) {
  const { state, dispatch } = useAppState()
  const s = state.settings ?? DEFAULT_SETTINGS
  const ref = useRef<HTMLDivElement>(null)
  const set = (patch: Partial<Settings>): void => void updateSettings(dispatch, patch)

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const anchor = ref.current?.parentElement
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    // Clicks inside the book iframe never reach this window, so losing focus to it closes the menu too.
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const segment = <T extends string | number>(value: T, current: T, label: string, onPick: () => void, testId?: string) => (
    <button key={String(value)} className={`seg ${value === current ? 'on' : ''}`} onClick={onPick} data-testid={testId}>{label}</button>
  )

  return (
    <div className="reader-menu" ref={ref} role="dialog" aria-label="Appearance" data-testid="reader-settings-menu">
      <div className="reader-menu-themes">
        {(Object.keys(READER_THEMES) as ReaderTheme[]).map(name => {
          const t = READER_THEMES[name]
          return (
            <button
              key={name}
              className={`theme-swatch ${s.readerTheme === name ? 'on' : ''}`}
              style={{ background: t.bg, color: t.fg }}
              onClick={() => set({ readerTheme: name })}
              title={t.label}
              aria-label={`${t.label} theme`}
              data-testid={`theme-${name}`}
            >
              {s.readerTheme === name ? <Check size={14} /> : 'Aa'}
            </button>
          )
        })}
      </div>
      <div className="seg-group">
        {segment('serif', s.fontFamily, 'Serif', () => set({ fontFamily: 'serif' }), 'font-serif')}
        {segment('sans', s.fontFamily, 'Sans', () => set({ fontFamily: 'sans' }), 'font-sans')}
      </div>
      <div className="seg-group size">
        <button className="seg small-a" disabled={s.fontSize <= MIN_SIZE} onClick={() => set({ fontSize: Math.max(MIN_SIZE, s.fontSize - 1) })} aria-label="Smaller text" data-testid="font-smaller">A</button>
        <span className="size-value">{s.fontSize}</span>
        <button className="seg big-a" disabled={s.fontSize >= MAX_SIZE} onClick={() => set({ fontSize: Math.min(MAX_SIZE, s.fontSize + 1) })} aria-label="Larger text" data-testid="font-larger">A</button>
      </div>
      <div className="reader-menu-label">Line spacing</div>
      <div className="seg-group">
        {LINE_HEIGHTS.map((lh, i) => segment(lh, s.lineHeight, ['Compact', 'Normal', 'Relaxed'][i], () => set({ lineHeight: lh })))}
      </div>
      <div className="reader-menu-label">Layout</div>
      <div className="seg-group">
        {segment('paginated', s.flow, 'Pages', () => set({ flow: 'paginated' }), 'flow-paginated')}
        {segment('scrolled', s.flow, 'Scroll', () => set({ flow: 'scrolled' }), 'flow-scrolled')}
      </div>
    </div>
  )
}
