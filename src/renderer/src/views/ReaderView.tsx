import { useCallback, useEffect, useRef, useState } from 'react'
import type { Highlight, HighlightColor, Settings } from '../../../shared/types'
import { LIMITS } from '../../../shared/types'
import { useAppState } from '../state/appState'
import { refreshBooks, toast } from '../state/actions'
import { bookFile, loadFoliateView, loadOverlayer, makeBook, neuterBookScripts, type FoliateBook, type FoliateOverlayer, type FoliateTocItem } from '../reader/foliate'
import { emitReader, onReader } from '../reader/bus'
import { HIGHLIGHT_FILL, readerCss } from '../reader/readerStyles'
import { contextFromRange, quoteFromRange } from '../reader/selection'
import { lookupTerm, sentenceAround } from '../vocab/text'
import { findQuoteRange } from '../reader/anchor'
import { drawable } from '../reader/drawable'
import { NoteComposer } from '../reader/NoteComposer'
import { lostAnchors } from '../reader/lostAnchors'
import { HighlightPopup, type PopupState } from '../reader/HighlightPopup'
import { ReaderToolbar } from '../reader/ReaderToolbar'
import { TocDrawer } from '../reader/TocDrawer'
import '../reader/reader.css'

type FoliateView = HTMLElement & {
  open(b: File | FoliateBook): Promise<void>
  init(o: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
  goTo(t: string | number): Promise<unknown>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  addAnnotation(a: { value: string; color?: HighlightColor }): Promise<unknown>
  deleteAnnotation(a: { value: string }): Promise<unknown>
  getCFI(index: number, range: Range): string
  resolveNavigation(t: string): { index: number; anchor: (doc: Document) => Range | null } | undefined
  close(): void
  isFixedLayout: boolean
  book: { toc?: FoliateTocItem[] }
  renderer: HTMLElement & { setStyles?: (css: string) => void }
}

interface RelocateDetail { fraction?: number; cfi?: string; tocItem?: { label?: string } | null }
interface DrawDetail {
  draw: (fn: FoliateOverlayer['highlight'], opts: { color: string }) => void
  annotation: { value: string; color?: HighlightColor }
}

const SAVE_DEBOUNCE_MS = 1000
const CHROME_HIDE_MS = 2000
const SWIPE_THRESHOLD = 60
const SWIPE_WINDOW_MS = 300

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof Element && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable)

function safeResolve(view: FoliateView, cfi: string): ReturnType<FoliateView['resolveNavigation']> {
  try {
    return view.resolveNavigation(cfi)
  } catch {
    return undefined
  }
}

// Viewport rect of a range inside a book iframe.
function viewportRect(range: Range): DOMRect {
  const r = range.getBoundingClientRect()
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
  const f = frame?.getBoundingClientRect()
  return new DOMRect(r.left + (f?.left ?? 0), r.top + (f?.top ?? 0), r.width, r.height)
}

function applySettings(view: FoliateView, s: Settings): void {
  view.renderer.setStyles?.(readerCss(s))
  const r = view.renderer
  r.setAttribute('flow', s.flow)
  r.setAttribute('margin', '56px')
  r.setAttribute('gap', '7%')
  r.setAttribute('max-inline-size', '680px')
  r.setAttribute('max-column-count', '2')
}

export function ReaderView({ bookId, target }: { bookId: string; target?: string }) {
  const { state, dispatch } = useAppState()
  const book = state.books.find(b => b.id === bookId)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const docs = useRef(new Map<number, Document>())
  const byValue = useRef(new Map<string, Highlight>())
  const position = useRef({ fraction: 0, cfi: '', chapter: '' })
  const [toc, setToc] = useState<FoliateTocItem[]>([])
  const [chapter, setChapter] = useState('')
  const [fraction, setFraction] = useState(0)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [composer, setComposer] = useState<{ location: string; chapter: string; position: number } | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fixedLayout, setFixedLayout] = useState(false)

  // Event handlers are bound once per book, so they read live values through refs.
  const settingsRef = useRef(state.settings)
  settingsRef.current = state.settings
  const initial = useRef({ location: book?.location ?? null, target })
  const overlays = useRef({ popup: false, toc: false, menu: false, composer: false })
  overlays.current = { popup: popup !== null, toc: tocOpen, menu: menuOpen, composer: composer !== null }
  const lastColor = useRef<HighlightColor>('yellow')
  // The popup's note text as typed, so a click back into the book can save it instead of dropping it.
  const popupRef = useRef<PopupState | null>(null)
  popupRef.current = popup
  const noteDraft = useRef('')
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const showChrome = useCallback((): void => {
    setChrome(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      const o = overlays.current
      if (!o.popup && !o.toc && !o.menu && !o.composer) setChrome(false)
    }, CHROME_HIDE_MS)
  }, [])

  // 14. Keep chrome up while an overlay is open and restart the fade when it closes.
  useEffect(() => {
    showChrome()
  }, [popup, tocOpen, menuOpen, composer, showChrome])
  useEffect(() => () => clearTimeout(hideTimer.current), [])

  // 1–13, 15. The foliate view lifecycle for this book.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let view: FoliateView | null = null
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let pendingSave: { cfi: string; fraction: number } | null = null
    let lastActivity = 0
    const swipe = { acc: 0, last: 0, fired: false }
    const cleanups: Array<() => void> = []

    const flushSave = async (): Promise<void> => {
      clearTimeout(saveTimer)
      const p = pendingSave
      pendingSave = null
      if (p) await window.api.library.saveProgress(bookId, p.cfi, p.fraction).catch(() => undefined)
    }

    const activity = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastActivity < 250) return
      lastActivity = now
      emitReader('activity', { bookId })
    }

    const highlightsChanged = (): void => emitReader('highlights-changed', { bookId })

    // Fixed-layout (PDF) fallback: foliate's fxl renderer emits `load` per page but has no Overlayer
    // (no create-overlayer, no show-annotation), so highlights are drawn as divs inside each page doc.
    const fxlPages = new Map<Document, number>()
    const fxlHits = new Map<Document, Array<{ value: string; range: Range; rects: DOMRect[] }>>()

    const drawFxlPage = (doc: Document, index: number): void => {
      if (!view || !doc.body) return
      doc.querySelector('.sr-hl-layer')?.remove()
      const de = doc.documentElement
      const origin = de.getBoundingClientRect()
      // pdf.js scales <html> by 1/devicePixelRatio; convert viewport rects back to layout px.
      const scale = de.offsetWidth ? origin.width / de.offsetWidth : 1
      const layer = doc.createElement('div')
      layer.className = 'sr-hl-layer'
      Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: '1' })
      const hits: Array<{ value: string; range: Range; rects: DOMRect[] }> = []
      for (const [value, h] of byValue.current) {
        const resolved = safeResolve(view, h.location)
        if (!resolved || resolved.index !== index) continue
        let range: Range | null = null
        try {
          range = resolved.anchor(doc)
        } catch {
          range = null
        }
        if (!range || typeof range.getClientRects !== 'function') continue
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
        if (!rects.length) continue
        hits.push({ value, range, rects })
        const group = doc.createElement('div')
        group.dataset.value = value
        Object.assign(group.style, { opacity: '0.35', mixBlendMode: 'multiply' })
        for (const r of rects) {
          const d = doc.createElement('div')
          Object.assign(d.style, {
            position: 'absolute',
            left: `${(r.left - origin.left) / scale}px`,
            top: `${(r.top - origin.top) / scale}px`,
            width: `${r.width / scale}px`,
            height: `${r.height / scale}px`,
            background: HIGHLIGHT_FILL[h.color],
            borderRadius: '2px'
          })
          group.append(d)
        }
        layer.append(group)
      }
      fxlHits.set(doc, hits)
      if (layer.childElementCount) doc.body.append(layer)
    }

    const redrawFxl = (): void => {
      for (const [doc, index] of fxlPages) {
        if (!doc.defaultView) {
          fxlPages.delete(doc)
          fxlHits.delete(doc)
        } else drawFxlPage(doc, index)
      }
    }

    const setupFxlPage = (doc: Document, index: number): void => {
      fxlPages.set(doc, index)
      // The pdf.js text layer renders after `load` and again on every zoom/resize; redraw when it settles.
      let timer: ReturnType<typeof setTimeout> | undefined
      const schedule = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (!disposed && doc.defaultView) drawFxlPage(doc, index)
        }, 60)
      }
      const textLayer = doc.querySelector('.textLayer')
      if (textLayer) new MutationObserver(schedule).observe(textLayer, { childList: true, subtree: true })
      schedule()
      doc.addEventListener('click', e => {
        if (!doc.getSelection()?.isCollapsed) return
        const hits = fxlHits.get(doc) ?? []
        for (let i = hits.length - 1; i >= 0; i--) {
          const { value, range, rects } = hits[i]
          if (rects.some(r => r.left <= e.clientX && e.clientX < r.right && r.top <= e.clientY && e.clientY < r.bottom)) {
            showExisting(value, range)
            return
          }
        }
      })
    }

    const annotate = (value: string, color: HighlightColor): void => {
      if (view?.isFixedLayout) redrawFxl()
      else view?.addAnnotation({ value, color }).catch(() => undefined)
    }

    const unannotate = (value: string): void => {
      if (view?.isFixedLayout) redrawFxl()
      else view?.deleteAnnotation({ value }).catch(() => undefined)
    }

    const closeOverlays = (): boolean => {
      const o = overlays.current
      if (o.composer) setComposer(null)
      else if (o.popup) setPopup(null)
      else if (o.toc) setTocOpen(false)
      else return false
      return true
    }

    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPopup(null)
        void view?.goLeft()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPopup(null)
        void view?.goRight()
      } else if (e.key === 'Escape') {
        closeOverlays()
      }
    }

    const onWheel = (e: WheelEvent): void => {
      activity()
      if (settingsRef.current?.flow === 'scrolled' || !view) return
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      const now = e.timeStamp || Date.now()
      if (now - swipe.last > SWIPE_WINDOW_MS) {
        swipe.acc = 0
        swipe.fired = false
      }
      swipe.last = now
      swipe.acc += e.deltaX
      if (!swipe.fired && Math.abs(swipe.acc) > SWIPE_THRESHOLD) {
        swipe.fired = true
        setPopup(null)
        void (swipe.acc > 0 ? view.goRight() : view.goLeft())
      }
    }

    const createHighlight = async (doc: Document, index: number, range: Range, color: HighlightColor, note: string | null): Promise<void> => {
      if (!view) return
      if (range.toString().length > LIMITS.exactMaxChars) {
        toast(dispatch, 'warning', 'Selection is too long to highlight')
        return
      }
      lastColor.current = color
      try {
        const cfi = view.getCFI(index, range)
        const h = await window.api.highlights.add(bookId, {
          location: cfi,
          quote: quoteFromRange(range),
          context: contextFromRange(range),
          chapter: position.current.chapter || null,
          position: position.current.fraction,
          color,
          note
        })
        byValue.current.set(cfi, h)
        annotate(cfi, color)
        doc.getSelection()?.removeAllRanges()
        setPopup(null)
        highlightsChanged()
      } catch (err) {
        toast(dispatch, 'error', `Could not save highlight: ${(err as Error).message}`)
      }
    }

    // 9. A non-empty selection in the book opens the popup in "new" mode.
    const checkSelection = (doc: Document, index: number): void => {
      const sel = doc.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0).cloneRange()
      const text = range.toString()
      if (!text.trim()) return
      setPopup({
        mode: 'new',
        rect: viewportRect(range),
        onColor: c => void createHighlight(doc, index, range, c, null),
        onNote: note => void createHighlight(doc, index, range, lastColor.current, note || null),
        term: lookupTerm(text),
        onLookUp: async () => {
          const term = lookupTerm(text)
          if (!term) return { ok: false, reason: 'not-found' }
          const r = await window.api.vocab.lookup(term)
          if (!r.ok) return r
          const sentence = sentenceAround(contextFromRange(range, 800), term)
          try {
            await window.api.vocab.save({
              headword: r.entry.headword,
              pronunciation: r.entry.pronunciation,
              definition: r.entry.text,
              ...(r.zh.status === 'ok' ? { zh: r.zh.gloss, zhEntry: r.zh.entry } : r.zh.status === 'not-found' ? { zh: null, zhEntry: null } : {}),
              context: { bookId, sentence, location: view!.getCFI(index, range), chapter: position.current.chapter || null }
            })
            return { ok: true, entry: r.entry, zh: r.zh, sentence, saved: true }
          } catch (err) {
            toast(dispatch, 'error', `Could not save word: ${(err as Error).message}`)
            return { ok: true, entry: r.entry, zh: r.zh, sentence, saved: false }
          }
        },
        onCopy: () => {
          let ok = false
          try {
            ok = doc.execCommand('copy')
          } catch {
            ok = false
          }
          if (!ok) void navigator.clipboard.writeText(text).catch(() => undefined)
          doc.getSelection()?.removeAllRanges()
          setPopup(null)
        }
      })
    }

    // 11. Clicking an existing highlight opens the popup in "edit" mode.
    const showExisting = (value: string, range: Range): void => {
      const h = byValue.current.get(value)
      if (!h) return
      const edit = (patch: { color?: HighlightColor; note?: string | null }): void => {
        void (async () => {
          try {
            const updated = await window.api.highlights.update(bookId, h.id, patch)
            byValue.current.set(value, updated)
            if (patch.color) {
              lastColor.current = patch.color
              annotate(value, patch.color)
            }
            setPopup(null)
            highlightsChanged()
          } catch (err) {
            toast(dispatch, 'error', `Could not update highlight: ${(err as Error).message}`)
          }
        })()
      }
      setPopup({
        mode: 'edit',
        rect: viewportRect(range),
        highlight: h,
        onColor: c => edit({ color: c }),
        onNote: note => edit({ note: note || null }),
        onDelete: () => {
          void (async () => {
            try {
              await window.api.highlights.remove(bookId, h.id)
              byValue.current.delete(value)
              unannotate(value)
              lostAnchors.delete(h.id)
              setPopup(null)
              highlightsChanged()
            } catch (err) {
              toast(dispatch, 'error', `Could not delete highlight: ${(err as Error).message}`)
            }
          })()
        }
      })
    }

    // A click in the book closes the popup, but a typed note is saved, not lost: a new selection
    // becomes a highlight in the last used color, an existing highlight gets the edited note.
    const dismissPopup = (): void => {
      const p = popupRef.current
      const draft = noteDraft.current.trim()
      noteDraft.current = ''
      const saved = p?.mode === 'edit' ? (p.highlight.note ?? '') : ''
      if (p && draft && draft !== saved) p.onNote(draft)
      else setPopup(null)
    }

    // 5. Per-section listeners on the iframe document.
    const onLoad = (e: Event): void => {
      const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail
      docs.current.set(index, doc)
      if (view?.isFixedLayout) setupFxlPage(doc, index)
      doc.addEventListener('keydown', e => {
        activity(true)
        onKey(e)
      })
      doc.addEventListener('pointerdown', () => {
        activity(true)
        dismissPopup()
      })
      doc.addEventListener('pointerup', () => {
        activity(true)
        setTimeout(() => checkSelection(doc, index), 10)
      })
      doc.addEventListener('mousemove', () => {
        activity()
        showChrome()
      })
      doc.addEventListener('wheel', e => {
        showChrome()
        onWheel(e)
      }, { passive: true })
    }

    // 6. Track position, save it debounced.
    const onRelocate = (e: Event): void => {
      const d = (e as CustomEvent<RelocateDetail>).detail
      const f = typeof d.fraction === 'number' ? d.fraction : position.current.fraction
      const label = d.tocItem?.label?.trim() ?? ''
      position.current = { fraction: f, cfi: d.cfi ?? position.current.cfi, chapter: label }
      setFraction(f)
      setChapter(label)
      if (d.cfi) {
        pendingSave = { cfi: d.cfi, fraction: f }
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS)
      }
      activity(true)
    }

    // 7. Draw stored highlights for a freshly loaded section, re-anchoring by quote when the CFI drifted.
    const onCreateOverlay = (e: Event): void => {
      const { index } = (e as CustomEvent<{ index: number }>).detail
      const doc = docs.current.get(index)
      if (!view || !doc) return
      const v = view
      let changed = false
      const recover = (h: Highlight, oldValue: string | null, range: Range): void => {
        let newCfi: string
        try {
          newCfi = v.getCFI(index, range)
        } catch {
          return
        }
        if (oldValue !== null) byValue.current.delete(oldValue)
        const moved = { ...h, location: newCfi }
        byValue.current.set(newCfi, moved)
        annotate(newCfi, h.color)
        lostAnchors.delete(h.id)
        changed = true
        if (newCfi !== h.location) {
          window.api.highlights.update(bookId, h.id, { location: newCfi })
            .then(u => {
              if (byValue.current.get(newCfi)?.id === u.id) byValue.current.set(newCfi, u)
            })
            .catch(() => undefined)
        }
      }

      for (const [value, h] of [...byValue.current]) {
        let resolved: ReturnType<FoliateView['resolveNavigation']>
        try {
          resolved = v.resolveNavigation(h.location)
        } catch {
          resolved = undefined
        }
        if (!resolved) {
          // Unresolvable CFI: treat as lost so the quote search below can recover it.
          if (!lostAnchors.has(h.id)) {
            lostAnchors.add(h.id)
            changed = true
          }
          continue
        }
        if (resolved.index !== index) continue
        let range: Range | null = null
        try {
          range = resolved.anchor(doc)
        } catch {
          range = null
        }
        if (range && norm(range.toString()) === norm(h.quote.exact)) {
          annotate(value, h.color)
          if (lostAnchors.has(h.id)) {
            lostAnchors.delete(h.id)
            changed = true
          }
          continue
        }
        const found = findQuoteRange(doc, h.quote)
        if (found) recover(h, value, found)
        else if (!lostAnchors.has(h.id)) {
          lostAnchors.add(h.id)
          changed = true
        }
      }

      for (const [value, h] of [...byValue.current]) {
        if (!lostAnchors.has(h.id)) continue
        const found = findQuoteRange(doc, h.quote)
        if (found) recover(h, value, found)
      }

      if (changed) highlightsChanged()
    }

    void (async () => {
      let file: File
      let Overlayer: FoliateOverlayer
      try {
        await loadFoliateView()
        Overlayer = await loadOverlayer()
        file = await bookFile(bookId)
      } catch (err) {
        if (disposed) return
        toast(dispatch, 'error', `Could not open this book: ${(err as Error).message}`)
        dispatch({ type: 'navigate', view: { name: 'library' } })
        return
      }
      if (disposed) return

      // 1. Create the view and wire every listener before open().
      view = document.createElement('foliate-view') as FoliateView
      view.style.setProperty('--overlayer-highlight-opacity', '0.35')
      view.addEventListener('load', onLoad)
      view.addEventListener('relocate', onRelocate)
      view.addEventListener('create-overlay', onCreateOverlay)
      view.addEventListener('draw-annotation', e => {
        const { draw, annotation } = (e as CustomEvent<DrawDetail>).detail
        draw(Overlayer.highlight, { color: HIGHLIGHT_FILL[annotation.color ?? 'yellow'] })
      })
      view.addEventListener('show-annotation', e => {
        const { value, range } = (e as CustomEvent<{ value: string; range: Range }>).detail
        showExisting(value, range)
      })
      host.append(view)
      viewRef.current = view

      try {
        const book = await makeBook(file)
        neuterBookScripts(book)
        if (disposed) return
        await view.open(book)
      } catch (err) {
        if (disposed) return
        const e = err as Error
        const unsupported = e.name === 'UnsupportedTypeError' || e.constructor?.name === 'UnsupportedTypeError'
        await window.api.library.setStatus(bookId, unsupported ? 'unsupported' : 'error', e.message).catch(() => undefined)
        toast(dispatch, 'error', unsupported ? 'This book format is not supported.' : `Could not open this book: ${e.message}`)
        dispatch({ type: 'navigate', view: { name: 'library' } })
        return
      }
      if (disposed) return

      // 2. Settings before the first section renders.
      setToc(view.book.toc ?? [])
      setFixedLayout(view.isFixedLayout)
      if (settingsRef.current) applySettings(view, settingsRef.current)
      setReady(true)

      // 3. Highlights must be known before init draws the first section.
      try {
        const list = await window.api.highlights.list(bookId)
        byValue.current = new Map(drawable(list).map(h => [h.location, h]))
      } catch {
        byValue.current = new Map()
      }
      if (disposed) return

      // 4. Go to the deep-link target, else the saved position, else the start of the text.
      const loc = initial.current.target ?? initial.current.location ?? undefined
      try {
        await view.init({ lastLocation: loc, showTextStart: !loc })
      } catch (err) {
        console.error('reader init failed', err)
        await view.init({ showTextStart: true }).catch(() => undefined)
      }
      if (disposed) return
      setLoading(false)
      void window.api.library.markOpened(bookId).catch(() => undefined)
    })()

    // 12. Window-level keys and swipes (the iframe handles its own in onLoad).
    const winKey = (e: KeyboardEvent): void => {
      if (!e.defaultPrevented) onKey(e)
    }
    const winWheel = (e: WheelEvent): void => {
      showChrome()
      onWheel(e)
    }
    window.addEventListener('keydown', winKey)
    window.addEventListener('wheel', winWheel, { passive: true })
    cleanups.push(() => window.removeEventListener('keydown', winKey))
    cleanups.push(() => window.removeEventListener('wheel', winWheel))
    // ⌘Q/⌘W close the window without unmounting React, so flush the debounced position here too.
    const onUnload = (): void => void flushSave()
    window.addEventListener('pagehide', onUnload)
    window.addEventListener('beforeunload', onUnload)
    cleanups.push(() => window.removeEventListener('pagehide', onUnload))
    cleanups.push(() => window.removeEventListener('beforeunload', onUnload))

    // 13. Navigation requests from the highlights panel, review, etc.
    cleanups.push(onReader('goto', ({ target }) => {
      setPopup(null)
      void viewRef.current?.goTo(target)
    }))

    // Notes: capture where the reader is right now, then open the composer.
    cleanups.push(onReader('new-note', () => {
      setPopup(null)
      const p = position.current
      setComposer({ location: p.cfi, chapter: p.chapter, position: p.fraction })
    }))

    // 15. Teardown.
    return () => {
      disposed = true
      cleanups.forEach(off => off())
      void flushSave().then(() => refreshBooks(dispatch)).catch(() => undefined)
      if (view) {
        try {
          view.close()
        } catch {
          // close() throws if the renderer never finished opening
        }
        view.remove()
      }
      viewRef.current = null
      docs.current.clear()
      emitReader('closed', { bookId })
    }
  }, [bookId, dispatch, showChrome])

  // The view is keyed by book, so a new deep-link target into the open book arrives as a prop change.
  const appliedTarget = useRef(target)
  useEffect(() => {
    if (!ready || !target || target === appliedTarget.current) return
    appliedTarget.current = target
    setPopup(null)
    void viewRef.current?.goTo(target)
  }, [ready, target])

  // 2. Re-apply settings whenever they change.
  useEffect(() => {
    const view = viewRef.current
    if (ready && view && state.settings) applySettings(view, state.settings)
  }, [ready, state.settings])

  const theme = state.settings?.readerTheme ?? 'white'
  const chromeVisible = chrome || popup !== null || composer !== null || tocOpen || menuOpen
  // Fixed-layout pages are images of paper, so dark themes invert them instead of restyling text.
  const invert = fixedLayout && (theme === 'gray' || theme === 'night')
  return (
    <div
      className={`reader theme-${theme} ${chromeVisible ? '' : 'chrome-hidden'}`}
      data-testid="view-reader"
      onMouseMove={showChrome}
    >
      <ReaderToolbar
        title={book?.title ?? ''}
        chapter={chapter}
        tocOpen={tocOpen}
        onBack={() => dispatch({ type: 'navigate', view: { name: 'library' } })}
        onToc={() => setTocOpen(o => !o)}
        onNote={() => emitReader('new-note', {})}
        onMenuChange={setMenuOpen}
      />
      <div className={`reader-host${loading ? ' loading' : ''}${invert ? ' invert-pages' : ''}`} ref={hostRef} />
      <footer className="reader-footer">
        <span className="reader-footer-chapter">{chapter}</span>
        <span className="reader-progress" aria-hidden>
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
        <span>{Math.round(fraction * 100)}%</span>
      </footer>
      {tocOpen && (
        <TocDrawer
          toc={toc}
          current={chapter}
          onPick={href => {
            void viewRef.current?.goTo(href)
            setTocOpen(false)
          }}
          onClose={() => setTocOpen(false)}
        />
      )}
      {composer && (
        <NoteComposer
          onClose={() => setComposer(null)}
          onSave={text => {
            const c = composer
            void window.api.highlights
              .addNote(bookId, { location: c.location, chapter: c.chapter || null, position: c.position, text })
              .then(() => {
                setComposer(null)
                emitReader('highlights-changed', { bookId })
              })
              .catch((err: Error) => toast(dispatch, 'error', `Could not save note: ${err.message}`))
          }}
        />
      )}
      {popup && (
        <HighlightPopup
          key={`${popup.mode}-${popup.rect.x}-${popup.rect.y}`}
          state={popup}
          onClose={() => setPopup(null)}
          onDraft={d => {
            noteDraft.current = d
          }}
        />
      )}
    </div>
  )
}
