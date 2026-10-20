// foliate-js is vendored unbundled in public/foliate-js and imported at runtime.
export interface FoliateTocItem { label: string; href: string; subitems?: FoliateTocItem[] }
export interface FoliateBook {
  metadata?: { title?: unknown; author?: unknown; language?: unknown }
  toc?: FoliateTocItem[]
  sections: unknown[]
  getCover?: () => Promise<Blob | null>
  transformTarget?: EventTarget
}
export interface FoliateOverlayer {
  highlight: (rects: unknown, options?: { color?: string }) => SVGElement
  underline: (rects: unknown, options?: { color?: string }) => SVGElement
}

const url = (p: string): string => new URL(`foliate-js/${p}`, document.baseURI).href
let viewP: Promise<{ makeBook: (f: File) => Promise<FoliateBook> }> | null = null

function viewModule(): Promise<{ makeBook: (f: File) => Promise<FoliateBook> }> {
  return (viewP ??= import(/* @vite-ignore */ url('view.js')))
}

export async function loadFoliateView(): Promise<void> {
  await viewModule()
}

export async function makeBook(file: File): Promise<FoliateBook> {
  return (await viewModule()).makeBook(file)
}

const SCRIPT_TYPE = /^(application|text)\/(x-)?(java|ecma)script$/i
const MARKUP_TYPES = ['application/xhtml+xml', 'text/html', 'image/svg+xml']

export function stripScripts(markup: string): string {
  return markup.replace(/<script\b[^>]*\/>/gi, '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
}

// Defense in depth for book content (the CSP is the real control): drop script resources and
// <script> elements before foliate turns them into same-origin blob: URLs, where they could reach window.api.
export function neuterBookScripts(book: FoliateBook): void {
  book.transformTarget?.addEventListener('data', e => {
    const detail = (e as CustomEvent<{ data: unknown; type: unknown }>).detail
    detail.data = Promise.all([detail.data, detail.type]).then(([data, type]) => {
      if (typeof type !== 'string') return data
      if (SCRIPT_TYPE.test(type)) return ''
      if (typeof data === 'string' && MARKUP_TYPES.includes(type)) return stripScripts(data)
      return data
    })
  })
}

export async function loadOverlayer(): Promise<FoliateOverlayer> {
  const m = await import(/* @vite-ignore */ url('overlayer.js'))
  return m.Overlayer as FoliateOverlayer
}

export async function bookFile(bookId: string): Promise<File> {
  const { name, data } = await window.api.library.readBook(bookId)
  return new File([data as BlobPart], name)
}

export function formatLanguageMap(x: unknown): string {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object') {
    const values = Object.values(x as Record<string, unknown>)
    return typeof values[0] === 'string' ? values[0] : ''
  }
  return ''
}

export function formatContributor(x: unknown): string {
  const one = (c: unknown): string =>
    typeof c === 'string' ? c : formatLanguageMap((c as { name?: unknown } | null)?.name)
  if (Array.isArray(x)) return x.map(one).filter(Boolean).join(', ')
  return one(x)
}
