export interface ReaderEvents {
  goto: { target: string }
  'highlights-changed': { bookId: string }
  activity: { bookId: string }
  closed: { bookId: string }
  'new-note': Record<string, never>
}

const bus = new EventTarget()

export function emitReader<K extends keyof ReaderEvents>(type: K, detail: ReaderEvents[K]): void {
  bus.dispatchEvent(new CustomEvent(type, { detail }))
}

export function onReader<K extends keyof ReaderEvents>(type: K, cb: (d: ReaderEvents[K]) => void): () => void {
  const h = (e: Event): void => cb((e as CustomEvent<ReaderEvents[K]>).detail)
  bus.addEventListener(type, h)
  return () => bus.removeEventListener(type, h)
}
