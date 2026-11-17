import { describe, expect, it } from 'vitest'
import { idbOutbox } from '../../src/web/sync/outbox'
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
})
