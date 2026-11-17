// Bridges the api's pickFolder() (plain async code) to the React sheet that WebRoot renders.
export type PickedFolder = { id: string; name: string }
type Handler = (resolve: (f: PickedFolder | null) => void) => void

let handler: Handler | null = null
let open: ((f: PickedFolder | null) => void) | null = null

export function onFolderRequest(h: Handler): () => void {
  handler = h
  return () => {
    if (handler === h) handler = null
  }
}

export function requestFolder(): Promise<PickedFolder | null> {
  // A newer request cancels the one still open.
  open?.(null)
  return new Promise(resolve => {
    if (!handler) return resolve(null)
    const done = (f: PickedFolder | null): void => {
      if (open === done) open = null
      resolve(f)
    }
    open = done
    handler(done)
  })
}
