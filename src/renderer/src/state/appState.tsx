import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { Book, Settings, Toast } from '../../../shared/types'

export type View =
  | { name: 'library' }
  | { name: 'reader'; bookId: string; target?: string }
  | { name: 'review' }
  | { name: 'stats' }

export type SidebarTab = 'library' | 'highlights' | 'review' | 'stats'

export interface AppState {
  status: 'loading' | 'ready'
  root: string | null
  books: Book[]
  view: View
  sidebarTab: SidebarTab
  terminalOpen: boolean
  terminalMounted: boolean
  settings: Settings | null
  toasts: Array<Toast & { id: number }>
  dueCount: number
}

export type Action =
  | { type: 'settings'; settings: Settings }
  | { type: 'libraryOpened'; root: string; books: Book[] }
  | { type: 'libraryClosed' }
  | { type: 'books'; books: Book[] }
  | { type: 'navigate'; view: View }
  | { type: 'sidebarTab'; tab: SidebarTab }
  | { type: 'toggleTerminal'; open?: boolean }
  | { type: 'toast'; toast: Toast }
  | { type: 'dismissToast'; id: number }
  | { type: 'dueCount'; count: number }

export const initialState: AppState = {
  status: 'loading',
  root: null,
  books: [],
  view: { name: 'library' },
  sidebarTab: 'library',
  terminalOpen: false,
  terminalMounted: false,
  settings: null,
  toasts: [],
  dueCount: 0
}

let toastSeq = 0
const TAB_FOR_VIEW: Record<View['name'], SidebarTab> = { library: 'library', reader: 'highlights', review: 'review', stats: 'stats' }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'settings':
      return { ...state, settings: action.settings }
    case 'libraryOpened':
      return { ...state, status: 'ready', root: action.root, books: action.books, view: { name: 'library' }, sidebarTab: 'library' }
    case 'libraryClosed':
      return { ...state, status: 'ready', root: null, books: [], view: { name: 'library' } }
    case 'books':
      return { ...state, books: action.books }
    case 'navigate':
      return { ...state, view: action.view, sidebarTab: TAB_FOR_VIEW[action.view.name] }
    case 'sidebarTab':
      return { ...state, sidebarTab: action.tab }
    case 'toggleTerminal': {
      const open = action.open ?? !state.terminalOpen
      return { ...state, terminalOpen: open, terminalMounted: state.terminalMounted || open }
    }
    case 'toast':
      return { ...state, toasts: [...state.toasts, { ...action.toast, id: ++toastSeq }].slice(-4) }
    case 'dismissToast':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) }
    case 'dueCount':
      return { ...state, dueCount: action.count }
  }
}

const Ctx = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

export function useAppState(): { state: AppState; dispatch: Dispatch<Action> } {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppState outside provider')
  return v
}
