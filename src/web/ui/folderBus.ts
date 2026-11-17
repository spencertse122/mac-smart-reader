// Bridges the api's pickFolder() (plain async code) to the React sheet that WebRoot renders.
export type PickedFolder = { id: string; name: string }
type Handler = (resolve: (f: PickedFolder | null) => void) => void

let handler: Handler | null = null

export function onFolderRequest(h: Handler): () => void {
  handler = h
  return () => {
    if (handler === h) handler = null
  }
}

export function requestFolder(): Promise<PickedFolder | null> {
  return new Promise(resolve => (handler ? handler(resolve) : resolve(null)))
}
