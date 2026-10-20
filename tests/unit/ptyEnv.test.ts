import { describe, it, expect } from 'vitest'
import { ptyEnv } from '../../src/main/pty/env'

describe('ptyEnv', () => {
  it('sets terminal vars and drops undefined values', () => {
    const env = ptyEnv({ PATH: '/bin', LANG: 'en_GB.UTF-8', EMPTY: undefined })
    expect(env).toMatchObject({ PATH: '/bin', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'SmartReader' })
    expect('EMPTY' in env).toBe(false)
  })

  it('gives a GUI-launched app (no locale vars) a UTF-8 locale', () => {
    expect(ptyEnv({ PATH: '/bin' }).LANG).toBe('en_US.UTF-8')
  })

  it("keeps the user's UTF-8 locale", () => {
    expect(ptyEnv({ LANG: 'de_DE.UTF-8' }).LANG).toBe('de_DE.UTF-8')
    expect(ptyEnv({ LANG: 'fr_FR.utf8' }).LANG).toBe('fr_FR.utf8')
    const ctype = ptyEnv({ LC_CTYPE: 'UTF-8' })
    expect(ctype.LC_CTYPE).toBe('UTF-8')
    expect(ctype.LANG).toBeUndefined()
    expect(ptyEnv({ LC_ALL: 'ja_JP.UTF-8', LANG: 'C' })).toMatchObject({ LC_ALL: 'ja_JP.UTF-8', LANG: 'C' })
  })

  it('replaces non-UTF-8 locales so the effective character set is UTF-8', () => {
    expect(ptyEnv({ LANG: 'C' }).LANG).toBe('en_US.UTF-8')
    const env = ptyEnv({ LANG: 'C', LC_ALL: 'POSIX', LC_CTYPE: 'C' })
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.LC_ALL).toBeUndefined()
    expect(env.LC_CTYPE).toBeUndefined()
    // a UTF-8 LANG is kept when only an overriding LC_* var was the problem
    expect(ptyEnv({ LANG: 'de_DE.UTF-8', LC_CTYPE: 'C' })).toMatchObject({ LANG: 'de_DE.UTF-8' })
    expect(ptyEnv({ LANG: 'de_DE.UTF-8', LC_CTYPE: 'C' }).LC_CTYPE).toBeUndefined()
  })
})
