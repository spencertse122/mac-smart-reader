import { useEffect, useRef, useState } from 'react'
import { CircleUserRound, FolderOpen } from 'lucide-react'
import { useAppState } from '../state/appState'
import { chooseAndOpenLibrary } from '../state/actions'

// The sidebar footer's folder/account menu, for screens without a sidebar.
export function AccountButton() {
  const { state, dispatch } = useAppState()
  const account = window.api.account
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  const folder = state.root?.split('/').filter(Boolean).pop() ?? ''
  if (!account) {
    return (
      <button className="m-account-btn" onClick={() => void chooseAndOpenLibrary(dispatch)} title="Open another folder">
        <FolderOpen size={16} /> <span>{folder}</span>
      </button>
    )
  }
  const email = account.email()
  return (
    <div className="m-account" ref={ref}>
      <button className="m-account-btn" onClick={() => setOpen(o => !o)} data-testid="account-menu" aria-expanded={open} aria-label="Account">
        <CircleUserRound size={17} /> <span>Account</span>
      </button>
      {open && (
        <div className="account-menu m-account-menu" role="menu">
          {email && <div className="m-account-email">{email}</div>}
          <button role="menuitem" onClick={() => { setOpen(false); void chooseAndOpenLibrary(dispatch) }}>Switch folder</button>
          <button role="menuitem" data-testid="sign-out" onClick={() => { setOpen(false); void account.signOut() }}>Sign out</button>
        </div>
      )}
    </div>
  )
}
