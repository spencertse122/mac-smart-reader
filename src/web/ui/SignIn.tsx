import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import type { Auth } from '../auth/gis'

export function SignIn({ auth, clientId }: { auth: Auth; clientId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
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
        <button className="web-btn web-btn-primary" data-testid="google-signin" disabled={busy} onClick={() => void go()}>
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
      ) : (
        <p className="web-error" data-testid="config-error">
          Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID when building the web app.
        </p>
      )}
      {error && <p className="web-error">{error}</p>}
    </div>
  )
}
