import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Folder, Library } from 'lucide-react'
import { FOLDER_MIME, type DriveClient } from '../drive/client'
import type { PickedFolder } from './folderBus'

type Crumb = PickedFolder

export function FolderPicker({ drive, onDone }: { drive: DriveClient; onDone: (f: PickedFolder | null) => void }) {
  const [detected, setDetected] = useState<PickedFolder[] | null>(null)
  const [stack, setStack] = useState<Crumb[]>([{ id: 'root', name: 'My Drive' }])
  const [children, setChildren] = useState<PickedFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const here = stack[stack.length - 1]

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        // A library is the parent of its .smartreader folder; one get() per hit keeps this to a few requests.
        const marks = await drive.findFoldersNamed('.smartreader')
        const ids = [...new Set(marks.map(m => m.parents?.[0]).filter((x): x is string => !!x))]
        const found = await Promise.all(ids.map(id => drive.get(id).catch(() => null)))
        if (live) setDetected(found.filter(f => f && f.mimeType === FOLDER_MIME).map(f => ({ id: f!.id, name: f!.name })))
      } catch {
        if (live) setDetected([])
      }
    })()
    return () => {
      live = false
    }
  }, [drive])

  useEffect(() => {
    let live = true
    setChildren(null)
    setError(null)
    drive
      .listChildren(here.id)
      .then(list => {
        if (live) setChildren(list.filter(f => f.mimeType === FOLDER_MIME).map(f => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name)))
      })
      .catch(e => {
        if (live) setError((e as Error).message)
      })
    return () => {
      live = false
    }
  }, [drive, here.id])

  return (
    <div className="web-sheet" role="dialog" aria-label="Choose your books folder">
      <header className="web-sheet-head">
        <button className="web-btn web-btn-ghost" onClick={() => (stack.length > 1 ? setStack(s => s.slice(0, -1)) : onDone(null))}>
          <ChevronLeft size={18} /> {stack.length > 1 ? 'Back' : 'Cancel'}
        </button>
        <strong className="web-sheet-title">{here.name}</strong>
        <span style={{ width: 80 }} />
      </header>
      <div className="web-sheet-body">
        {stack.length === 1 && detected && detected.length > 0 && (
          <section>
            <h2>Smart Reader libraries found in your Drive</h2>
            {detected.map(f => (
              <button key={f.id} className="web-row" data-testid="detected-folder" onClick={() => onDone(f)}>
                <Library size={20} />
                <span>{f.name}</span>
              </button>
            ))}
          </section>
        )}
        <section>
          <h2>Browse My Drive</h2>
          {error && <p className="web-error">{error}</p>}
          {!children && !error && <p className="web-muted">Loading…</p>}
          {children?.length === 0 && <p className="web-muted">No folders here.</p>}
          {children?.map(f => (
            <button key={f.id} className="web-row" onClick={() => setStack(s => [...s, f])}>
              <Folder size={20} />
              <span>{f.name}</span>
              <ChevronRight size={18} className="web-row-end" />
            </button>
          ))}
        </section>
      </div>
      <footer className="web-sheet-foot">
        <button className="web-btn web-btn-primary" data-testid="use-folder" disabled={stack.length === 1} onClick={() => onDone(here)}>
          Use this folder
        </button>
      </footer>
    </div>
  )
}
