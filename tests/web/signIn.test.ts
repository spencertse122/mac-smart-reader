// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SignIn } from '../../src/web/ui/SignIn'
import type { Auth } from '../../src/web/auth/gis'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SignIn', () => {
  it('enables the button when GIS became ready before the component subscribed', async () => {
    // The first render sees 'loading'; the ready event fired before onChange was attached, so it never arrives.
    let calls = 0
    const auth = {
      status: () => (calls++ === 0 ? 'loading' : 'ready'),
      onChange: () => () => {},
      signIn: async () => {},
      redirectError: () => null
    } as unknown as Auth
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(SignIn, { auth, clientId: 'test-client' })))
    const button = host.querySelector<HTMLButtonElement>('[data-testid=google-signin]')!
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Continue with Google')
    act(() => root.unmount())
  })
})
