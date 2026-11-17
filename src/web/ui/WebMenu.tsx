import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useAppState } from '../../renderer/src/state/appState'
import { openLibrary } from '../../renderer/src/state/actions'
import type { WebApi } from '../webApi'

export function WebMenu({ api, onSignOut }: { api: WebApi; onSignOut: () => void }) {
  const { dispatch } = useAppState()
  const [open, setOpen] = useState(false)
  const switchFolder = async (): Promise<void> => {
    setOpen(false)
    const root = await api.library.chooseFolder()
    if (root) await openLibrary(dispatch, root)
  }
  const signOut = (): void => {
    setOpen(false)
    const n = api.sync()?.pending() ?? 0
    if (n > 0 && !confirm(`${n} change${n === 1 ? '' : 's'} haven't synced to Google Drive yet. They stay on this device and sync after you sign in again. Sign out anyway?`)) return
    onSignOut()
  }
  return (
    <>
      <button className="web-menu-btn" aria-label="Menu" data-testid="web-menu" onClick={() => setOpen(o => !o)}>
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <>
          <div className="web-scrim" onClick={() => setOpen(false)} />
          <div className="web-menu" role="menu">
            <button role="menuitem" onClick={() => void switchFolder()}>Switch folder</button>
            <button role="menuitem" data-testid="sign-out" onClick={signOut}>Sign out</button>
          </div>
        </>
      )}
    </>
  )
}
