// Google Identity Services token client, browser-only. The token lives in sessionStorage so closing the tab signs out.
export const SCOPE = 'https://www.googleapis.com/auth/drive openid email'
const GSI_SRC = 'https://accounts.google.com/gsi/client'
const AUTH_KEY = 'sr.auth'
const EMAIL_KEY = 'sr.email'
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
  signIn(): Promise<void>
  reconnect(): Promise<void>
  signOut(): void
  onChange(cb: () => void): () => void
}

export interface AuthOpts {
  storage?: Storage
  localStorage?: Storage
  now?: () => number
  loadGoogle?: () => Promise<GoogleGlobal>
  fetch?: typeof fetch
}

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

  async function request(prompt: boolean): Promise<void> {
    const google = await load()
    const hint = email()
    const res = await new Promise<TokenResponse>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: resolve,
        error_callback: e => reject(new Error(e.message || e.type))
      })
      // Without a prior grant, omit prompt so GIS shows its own account/consent chooser.
      client.requestAccessToken(prompt && hint ? { prompt: '', login_hint: hint } : {})
    })
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

  return {
    token,
    email,
    signIn: () => request(false),
    reconnect: () => request(true),
    signOut() {
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
