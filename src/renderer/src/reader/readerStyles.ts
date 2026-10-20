import type { HighlightColor, ReaderTheme, Settings } from '../../../shared/types'

export const READER_THEMES: Record<ReaderTheme, { bg: string; fg: string; link: string; label: string }> = {
  white: { bg: '#ffffff', fg: '#1d1d1f', link: '#0a5fd6', label: 'White' },
  sepia: { bg: '#f8f1e3', fg: '#4f3d2a', link: '#8a5a19', label: 'Sepia' },
  gray: { bg: '#4a4a4d', fg: '#ececee', link: '#9ecbff', label: 'Gray' },
  night: { bg: '#121212', fg: '#c9c9cb', link: '#7fb4ff', label: 'Night' }
}

export const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
  yellow: '#ffd60a',
  green: '#34c759',
  blue: '#0a84ff',
  pink: '#ff375f'
}

export function readerCss(s: Pick<Settings, 'readerTheme' | 'fontFamily' | 'fontSize' | 'lineHeight'>): string {
  const t = READER_THEMES[s.readerTheme]
  const dark = s.readerTheme === 'gray' || s.readerTheme === 'night'
  const family = s.fontFamily === 'serif'
    ? `'New York', 'Iowan Old Style', Charter, Georgia, serif`
    : `-apple-system, 'SF Pro Text', system-ui, sans-serif`
  return `
    html { color-scheme: ${dark ? 'dark' : 'light'}; }
    html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
    body { font-family: ${family} !important; font-size: ${s.fontSize}px !important; line-height: ${s.lineHeight} !important; }
    p, li, blockquote, dd, div, span { font-family: inherit !important; line-height: ${s.lineHeight} !important; }
    body *:not(img):not(svg):not(svg *) { color: inherit !important; background-color: transparent !important; }
    a:any-link { color: ${t.link} !important; }
    img, svg, video { max-width: 100%; height: auto; }
    p { hyphens: auto; -webkit-hyphens: auto; }
    ::selection { background: rgba(10, 132, 255, 0.28); }
  `
}
