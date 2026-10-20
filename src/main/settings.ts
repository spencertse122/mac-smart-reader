import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { jsonFile, type JsonFile } from './store/jsonFile'

export class SettingsStore {
  private file: JsonFile<Partial<Settings>>

  constructor(userDataDir: string) {
    this.file = jsonFile<Partial<Settings>>(join(userDataDir, 'settings.json'), () => ({}))
  }

  async get(): Promise<Settings> {
    const s = await this.file.read()
    return { ...DEFAULT_SETTINGS, ...s, pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...s.pomodoro } }
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    await this.file.update(d => ({
      ...d,
      ...patch,
      pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...d.pomodoro, ...patch.pomodoro }
    }))
    return this.get()
  }

  async rememberLibrary(path: string): Promise<Settings> {
    const recent = (await this.get()).recentLibraries.filter(p => p !== path)
    return this.update({ libraryPath: path, recentLibraries: [path, ...recent].slice(0, 5) })
  }
}
