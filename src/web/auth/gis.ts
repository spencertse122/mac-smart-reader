// Google Identity Services token client, browser-only. The token lives in sessionStorage so closing the tab signs out.
export const SCOPE = 'https://www.googleapis.com/auth/drive openid email'
const GSI_SRC = 'https://accounts.google.com/gsi/client'
const AUTH_KEY = 'sr.auth'
const EMAIL_KEY = 'sr.email'
const STATE_KEY = 'sr.oauth.state'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const SKEW_MS = 60_000

type TokenResponse = { access_token?: string; expires_in?: number; error?: string }
type TokenClient = { requestAccessToken(o?: { prompt?: string; login_hint?: string }): void }
export type GoogleGlobal = {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string
        scope: string
        callback: (r: TokenResponse) => void
        error_callback: (e: { type: string; message?: string }) => void
      }): TokenClient
      revoke?(token: string, done?: () => void): void
    }
  }
}
declare global {
  interface Window {
    google?: GoogleGlobal
  }
}

export type Auth = {
  token(): string | null
  email(): string | null
  status(): 'loading' | 'ready' | 'error'
  whenReady(): Promise<void>
  signIn(): Promise<void>
  reconnect(): Promise<void>
  signOut(): void
  // Why the last redirect sign-in failed, if it did.
  redirectError(): string | null
  onChange(cb: () => void): () => void
}

type Loc = Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'> & { assign(url: string): void }

export interface AuthOpts {
  storage?: Storage
  localStorage?: Storage
  now?: () => number
  loadGoogle?: () => Promise<GoogleGlobal>
  fetch?: typeof fetch
  // Home-screen (standalone) apps sign in by redirect: the GIS popup does not reliably return to them on iOS.
  standalone?: () => boolean
  location?: Loc
  history?: Pick<History, 'replaceState'>
  // Runs before navigating away to Google, so nothing only in memory is lost.
  beforeRedirect?: () => Promise<void>
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; state: string; hint: string | null }): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state: o.state
  })
  if (o.hint) p.set('login_hint', o.hint)
  return `${AUTH_ENDPOINT}?${p}`
}

// The implicit-flow answer in the URL fragment: null if the fragment is not one.
export function parseAuthHash(hash: string, expectedState: string | null): TokenResponse | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''))
  if (!p.has('access_token') && !p.has('error')) return null
  if (!expectedState || p.get('state') !== expectedState) return { error: 'Sign-in response did not match this request' }
  const error = p.get('error')
  if (error) return { error }
  return { access_token: p.get('access_token')!, expires_in: Number(p.get('expires_in')) || 3600 }
}

const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

const randomState = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')

let gsi: Promise<GoogleGlobal> | null = null
function loadGsi(): Promise<GoogleGlobal> {
  if (window.google?.accounts) return Promise.resolve(window.google)
  gsi ??= new Promise<GoogleGlobal>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GSI_SRC
    s.async = true
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in failed to load')))
    s.onerror = () => {
      gsi = null
      reject(new Error('Could not load Google sign-in'))
    }
    document.head.appendChild(s)
  })
  return gsi
}

export function createAuth(clientId: string, opts: AuthOpts = {}): Auth {
  const session = opts.storage ?? sessionStorage
  const local = opts.localStorage ?? localStorage
  const now = opts.now ?? Date.now
  const load = opts.loadGoogle ?? loadGsi
  const doFetch = opts.fetch ?? ((i, init) => fetch(i, init))
  const standalone = opts.standalone ?? isStandalone
  const loc = opts.location ?? (typeof location !== 'undefined' ? location : undefined)
  const hist = opts.history ?? (typeof history !== 'undefined' ? history : undefined)
  const cbs = new Set<() => void>()
  const changed = (): void => cbs.forEach(cb => cb())
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }

  const token = (): string | null =>
    safe(() => {
      const raw = session.getItem(AUTH_KEY)
      if (!raw) return null
      const a = JSON.parse(raw) as { token: string; expiresAt: number }
      return now() < a.expiresAt - SKEW_MS ? a.token : null
    }, null)
  const email = (): string | null => safe(() => local.getItem(EMAIL_KEY), null)

  // The script and token client load at startup: requestAccessToken opens a popup, which mobile Safari
  // only allows synchronously inside the tap, so nothing may be awaited between the tap and that call.
  let client: TokenClient | null = null
  let status: 'loading' | 'ready' | 'error' = 'loading'
  let pending: { resolve: () => void; reject: (e: Error) => void } | null = null

  async function accept(res: TokenResponse): Promise<void> {
    if (!res.access_token) throw new Error(res.error ?? 'Google sign-in failed')
    const expiresAt = now() + (res.expires_in ?? 3600) * 1000
    safe(() => session.setItem(AUTH_KEY, JSON.stringify({ token: res.access_token, expiresAt })), undefined)
    try {
      const r = await doFetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { authorization: `Bearer ${res.access_token}` }
      })
      const info = (await r.json()) as { email?: string }
      if (info.email) safe(() => local.setItem(EMAIL_KEY, info.email!), undefined)
    } catch {
      // the email only improves the next login hint
    }
    changed()
  }
  const settle = (p: Promise<void>): void => {
    const cur = pending
    pending = null
    p.then(() => cur?.resolve(), e => cur?.reject(e as Error))
  }

  // Back from a redirect sign-in: take the token from the fragment, then drop it from the URL.
  let redirectError: string | null = null
  const returned = loc ? parseAuthHash(loc.hash, safe(() => session.getItem(STATE_KEY), null)) : null
  if (returned) {
    safe(() => session.removeItem(STATE_KEY), undefined)
    hist?.replaceState(null, '', `${loc!.pathname}${loc!.search}`)
    if (returned.access_token) void accept(returned).catch(() => undefined)
    else redirectError = returned.error ?? 'Google sign-in failed'
  }

  let google: GoogleGlobal | null = null
  const ready = load().then(
    g => {
      google = g
      client = g.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: r => settle(accept(r)),
        error_callback: e => settle(Promise.reject(new Error(e.message || e.type)))
      })
      status = 'ready'
      changed()
    },
    () => {
      status = 'error'
      changed()
    }
  )

  async function redirect(): Promise<void> {
    if (!loc) throw new Error('Cannot redirect to Google sign-in here')
    const state = randomState()
    safe(() => session.setItem(STATE_KEY, state), undefined)
    await opts.beforeRedirect?.()
    loc.assign(buildAuthUrl({ clientId, redirectUri: `${loc.origin}/`, state, hint: email() }))
    // The page is leaving; nothing settles here.
    return new Promise<void>(() => undefined)
  }

  function request(prompt: boolean): Promise<void> {
    if (standalone()) return redirect()
    return new Promise<void>((resolve, reject) => {
      if (!client) return reject(new Error(status === 'error' ? 'Could not load Google sign-in' : 'Google sign-in is still loading'))
      pending?.reject(new Error('Superseded'))
      pending = { resolve, reject }
      const hint = email()
      // Without a prior grant, omit prompt so GIS shows its own account/consent chooser.
      client.requestAccessToken(prompt && hint ? { prompt: '', login_hint: hint } : {})
    })
  }

  return {
    token,
    email,
    // The redirect flow does not need the GIS script.
    status: () => (standalone() ? 'ready' : status),
    whenReady: () => ready,
    signIn: () => request(false),
    reconnect: () => request(true),
    redirectError: () => redirectError,
    signOut() {
      const t = token()
      // Best effort: a copied token should not outlive the session for its remaining hour.
      if (t) safe(() => google?.accounts.oauth2.revoke?.(t, () => undefined), undefined)
      safe(() => session.removeItem(AUTH_KEY), undefined)
      safe(() => local.removeItem(EMAIL_KEY), undefined)
      changed()
    },
    onChange(cb) {
      cbs.add(cb)
      return () => cbs.delete(cb)
    }
  }
}
