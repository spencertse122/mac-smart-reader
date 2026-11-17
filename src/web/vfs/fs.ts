import * as promises from './fsPromises'
import { getVfs, norm } from './vfs'

export { promises }
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }

type Snap = { size: number; mtimeMs: number; ino: number }
type Listener = (cur: Snap, prev: Snap) => void
const watchers = new Map<string, Array<{ cb: Listener; off: () => void }>>()

// Event-driven rather than polled: fires on every change, local or from Drive.
export function watchFile(path: string, _opts: { interval?: number }, cb: Listener): void {
  const p = norm(path)
  const snap = (): Snap => {
    const e = getVfs().entry(p)
    return { size: e?.size ?? 0, mtimeMs: e?.mtimeMs ?? 0, ino: e ? 1 : 0 }
  }
  let prev = snap()
  const off = getVfs().onChange(op => {
    if (op.path !== p) return
    const cur = snap()
    const before = prev
    prev = cur
    cb(cur, before)
  })
  const list = watchers.get(p) ?? []
  list.push({ cb, off })
  watchers.set(p, list)
}

export function unwatchFile(path: string): void {
  const p = norm(path)
  for (const w of watchers.get(p) ?? []) w.off()
  watchers.delete(p)
}
