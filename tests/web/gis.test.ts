import { describe, expect, it } from 'vitest'
import { idbOutbox } from '../../src/web/sync/outbox'
import { buildAuthUrl, createAuth, parseAuthHash, SCOPE, type GoogleGlobal } from '../../src/web/auth/gis'

const mem = (): Storage => {
  const m = new Map<string, string>()
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: k => void m.delete(k),
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    }
  }
}

function setup(over: Partial<Parameters<typeof createAuth>[1]> & { session?: Storage; local?: Storage } = {}) {
  const session = over.session ?? mem()
  const local = over.local ?? mem()
  const revoked: string[] = []
  let t = 1_000_000
  const calls: Array<Record<string, unknown>> = []
  let initCfg: { callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback: (e: { type: string }) => void } | null = null
  const google: GoogleGlobal = {
    accounts: {
      oauth2: {
        initTokenClient: cfg => {
          initCfg = cfg as never
          return {
            requestAccessToken: o => {
              calls.push(o ?? {})
              initCfg!.callback({ access_token: 'tok', expires_in: 3600 })
            }
          }
        },
        revoke: (t: string) => void revoked.push(t)
      }
    }
  }
  const auth = createAuth('cid', {
    storage: session,
    localStorage: local,
    now: () => t,
    loadGoogle: async () => google,
    fetch: (async () => new Response(JSON.stringify({ email: 'a@b.c' }))) as typeof fetch,
    standalone: () => false,
    ...over
  })
  return { auth, session, local, calls, revoked, advance: (ms: number) => (t += ms) }
}

describe('auth', () => {
  it('token expires 60s early', async () => {
    const { auth, advance } = setup()
    await auth.whenReady()
    await auth.signIn()
    expect(auth.token()).toBe('tok')
    expect(auth.email()).toBe('a@b.c')
    advance(3600_000 - 61_000)
    expect(auth.token()).toBe('tok')
    advance(2_000)
    expect(auth.token()).toBeNull()
  })

  it('signOut clears token but not outbox', async () => {
    const { auth, session } = setup()
    const outbox = idbOutbox('sr.outbox.test')
    await outbox.put({ path: '/library/a.json', data: new Uint8Array([1]), baseMd5: null })
    await auth.whenReady()
    await auth.signIn()
    auth.signOut()
    expect(auth.token()).toBeNull()
    expect(session.getItem('sr.auth')).toBeNull()
    expect((await outbox.all()).map(i => i.path)).toEqual(['/library/a.json'])
  })

  it('reconnect uses an empty prompt with the login hint, first sign-in omits it', async () => {
    const { auth, calls } = setup()
    await auth.whenReady()
    await auth.signIn()
    expect(calls[0]).not.toHaveProperty('prompt')
    await auth.reconnect()
    expect(calls[1]).toEqual({ prompt: '', login_hint: 'a@b.c' })
  })

  it('requests the token synchronously inside the tap', async () => {
    const { auth, calls } = setup()
    await auth.whenReady()
    const p = auth.signIn()
    expect(calls).toHaveLength(1)
    await p
  })

  it('refuses to sign in before the script is ready', async () => {
    const { auth, calls } = setup()
    await expect(auth.signIn()).rejects.toThrow(/loading/)
    expect(calls).toHaveLength(0)
  })

  it('signOut revokes the token with Google (best effort)', async () => {
    const { auth, revoked } = setup()
    await auth.whenReady()
    await auth.signIn()
    auth.signOut()
    expect(revoked).toEqual(['tok'])
  })
})

describe('redirect sign-in (home-screen app)', () => {
  const fakeLocation = (hash = '') => {
    const loc = { origin: 'https://reader.example', pathname: '/', search: '', hash, assigned: [] as string[], assign: (u: string) => void loc.assigned.push(u) }
    return loc
  }
  const fakeHistory = () => {
    const h = { replaced: [] as string[], replaceState: (_s: unknown, _t: string, u?: string | URL | null) => void h.replaced.push(String(u)) }
    return h
  }

  it('builds the implicit-flow URL', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://reader.example/', state: 'st8', hint: 'a@b.c' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'https://reader.example/',
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state: 'st8',
      login_hint: 'a@b.c'
    })
    expect(new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://r/', state: 's', hint: null })).searchParams.has('login_hint')).toBe(false)
  })

  it('parses the hash and checks state', () => {
    expect(parseAuthHash('', 's')).toBeNull()
    expect(parseAuthHash('#/library', 's')).toBeNull()
    expect(parseAuthHash('#access_token=tok&token_type=Bearer&expires_in=3599&state=s', 's')).toEqual({ access_token: 'tok', expires_in: 3599 })
    expect(parseAuthHash('#access_token=tok&expires_in=3599&state=evil', 's')).toEqual({ error: 'Sign-in response did not match this request' })
    expect(parseAuthHash('#access_token=tok&expires_in=3599&state=s', null)).toEqual({ error: 'Sign-in response did not match this request' })
    expect(parseAuthHash('#error=access_denied&state=s', 's')).toEqual({ error: 'access_denied' })
  })

  it('standalone sign-in navigates to Google with a stored random state; the return stores the token and clears the hash', async () => {
    const session = mem()
    const local = mem()
    local.setItem('sr.email', 'a@b.c')
    const location = fakeLocation()
    const { auth, calls } = setup({ session, local, location, history: fakeHistory(), standalone: () => true })
    void auth.signIn()
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toHaveLength(0)
    expect(location.assigned).toHaveLength(1)
    const u = new URL(location.assigned[0])
    expect(u.searchParams.get('redirect_uri')).toBe('https://reader.example/')
    expect(u.searchParams.get('login_hint')).toBe('a@b.c')
    const state = u.searchParams.get('state')!
    expect(state).toMatch(/^[0-9a-f]{32}$/)
    expect(session.getItem('sr.oauth.state')).toBe(state)

    // Google redirects back; the app starts again in the same tab.
    const back = fakeLocation(`#access_token=redirected&token_type=Bearer&expires_in=3600&state=${state}`)
    const history = fakeHistory()
    const again = setup({ session, local, location: back, history, standalone: () => true }).auth
    expect(again.token()).toBe('redirected')
    expect(history.replaced).toEqual(['/'])
    expect(session.getItem('sr.oauth.state')).toBeNull()
  })

  it('a returned token with the wrong state is refused', () => {
    const session = mem()
    session.setItem('sr.oauth.state', 'mine')
    const history = fakeHistory()
    const { auth } = setup({ session, location: fakeLocation('#access_token=forged&expires_in=3600&state=theirs'), history, standalone: () => true })
    expect(auth.token()).toBeNull()
    expect(auth.redirectError()).toMatch(/did not match/)
    expect(history.replaced).toEqual(['/'])
  })

  it('a reconnect redirect waits for beforeRedirect (pending edits reach the outbox first)', async () => {
    const order: string[] = []
    const location = fakeLocation()
    location.assign = (u: string) => void order.push(`assign ${new URL(u).host}`)
    const { auth } = setup({
      location,
      history: fakeHistory(),
      standalone: () => true,
      beforeRedirect: async () => {
        await Promise.resolve()
        order.push('flushed')
      }
    })
    void auth.reconnect()
    await new Promise(r => setTimeout(r, 0))
    expect(order).toEqual(['flushed', 'assign accounts.google.com'])
  })
})
