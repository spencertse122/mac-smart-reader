import { useEffect, useState } from 'react'
import type { Auth } from '../auth/gis'
import type { WebApi } from '../webApi'

export function ReconnectBanner({ api, auth }: { api: WebApi; auth: Auth }) {
  const [show, setShow] = useState(false)
  useEffect(() => api.onAuthError(() => setShow(true)), [api])
  if (!show) return null
  const reconnect = async (): Promise<void> => {
    try {
      await auth.reconnect()
      setShow(false)
      await api.sync()?.flush()
    } catch {
      // stay visible so the user can retry
    }
  }
  return (
    <button className="web-banner" data-testid="reconnect" onClick={() => void reconnect()}>
      Google Drive disconnected — tap to reconnect
    </button>
  )
}
