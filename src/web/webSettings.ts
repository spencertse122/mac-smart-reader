import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

const KEY = 'sr.web.settings'
type Store = Pick<Storage, 'getItem' | 'setItem'>

// Same merge rules as the Mac SettingsStore; localStorage can be missing or throw, so it degrades to defaults.
export function webSettings(hasFolder: () => boolean, storage?: Store) {
  const st = (): Store | undefined => {
    try {
      return storage ?? globalThis.localStorage
    } catch {
      return undefined
    }
  }
  const read = (): Partial<Settings> => {
    try {
      const raw = st()?.getItem(KEY)
      return raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    } catch {
      return {}
    }
  }
  const merged = (s: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    ...s,
    pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...s.pomodoro },
    libraryPath: hasFolder() ? '/library' : null
  })
  return {
    async get(): Promise<Settings> {
      return merged(read())
    },
    async update(patch: Partial<Settings>): Promise<Settings> {
      const d = read()
      const next = { ...d, ...patch, pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...d.pomodoro, ...patch.pomodoro } }
      try {
        st()?.setItem(KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: settings last for this call only
      }
      return merged(next)
    }
  }
}
