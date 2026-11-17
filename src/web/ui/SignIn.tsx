import { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import type { Auth } from '../auth/gis'

export function SignIn({ auth, clientId }: { auth: Auth; clientId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState(auth.status())
  useEffect(() => auth.onChange(() => setStatus(auth.status())), [auth])
  const go = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // No await before this call: the popup must open inside the tap.
      await auth.signIn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="web-signin">
      <BookOpen size={52} strokeWidth={1.4} color="var(--accent)" />
      <h1>Smart Reader</h1>
      <p>Read, highlight, and remember. Your books and notes live in your own Google Drive.</p>
      {clientId ? (
        <button className="web-btn web-btn-primary" data-testid="google-signin" disabled={busy || status !== 'ready'} onClick={() => void go()}>
          {busy ? 'Signing in…' : status === 'loading' ? 'Loading…' : 'Continue with Google'}
        </button>
      ) : (
        <p className="web-error" data-testid="config-error">
          Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID when building the web app.
        </p>
      )}
      {status === 'error' && <p className="web-error">Could not load Google sign-in. Check your connection and reload.</p>}
      {error && <p className="web-error">{error}</p>}
    </div>
  )
}
