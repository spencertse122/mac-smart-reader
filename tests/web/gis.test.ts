import { describe, expect, it } from 'vitest'
import { createAuth, type GoogleGlobal } from '../../src/web/auth/gis'

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

function setup() {
  const session = mem()
  const local = mem()
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
        }
      }
    }
  }
  const auth = createAuth('cid', {
    storage: session,
    localStorage: local,
    now: () => t,
    loadGoogle: async () => google,
    fetch: (async () => new Response(JSON.stringify({ email: 'a@b.c' }))) as typeof fetch
  })
  return { auth, session, local, calls, advance: (ms: number) => (t += ms) }
}

describe('auth', () => {
  it('token expires 60s early', async () => {
    const { auth, advance } = setup()
    await auth.signIn()
    expect(auth.token()).toBe('tok')
    expect(auth.email()).toBe('a@b.c')
    advance(3600_000 - 61_000)
    expect(auth.token()).toBe('tok')
    advance(2_000)
    expect(auth.token()).toBeNull()
  })

  it('signOut clears token but not outbox', async () => {
    const { auth, session, local } = setup()
    local.setItem('sr.outbox.x', 'keep')
    await auth.signIn()
    auth.signOut()
    expect(auth.token()).toBeNull()
    expect(session.getItem('sr.auth')).toBeNull()
    expect(local.getItem('sr.outbox.x')).toBe('keep')
  })

  it('reconnect uses an empty prompt with the login hint, first sign-in omits it', async () => {
    const { auth, calls } = setup()
    await auth.signIn()
    expect(calls[0]).not.toHaveProperty('prompt')
    await auth.reconnect()
    expect(calls[1]).toEqual({ prompt: '', login_hint: 'a@b.c' })
  })
})
