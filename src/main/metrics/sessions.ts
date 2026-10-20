import { join } from 'node:path'
import type { SessionEntry } from '../../shared/types'
import { appendJsonl, readJsonl } from '../store/jsonl'

export class SessionLog {
  private path: string

  constructor(dataDir: string) {
    this.path = join(dataDir, 'sessions.jsonl')
  }

  async append(e: Omit<SessionEntry, 'minutes'>): Promise<SessionEntry | null> {
    const start = new Date(e.start).getTime()
    const end = new Date(e.end).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid session range')
    const minutes = Math.round((end - start) / 600) / 100
    if (minutes < 0.1) return null
    const entry: SessionEntry = { ...e, minutes }
    await appendJsonl(this.path, entry)
    return entry
  }

  async all(): Promise<SessionEntry[]> {
    return (await readJsonl<SessionEntry>(this.path)).items
  }
}
