import { useEffect, useState } from 'react'

const cache = new Map<string, string>()

export function useCover(bookId: string, hasCover: boolean): string | null {
  const [url, setUrl] = useState<string | null>(cache.get(bookId) ?? null)
  useEffect(() => {
    if (!hasCover || cache.has(bookId)) {
      setUrl(cache.get(bookId) ?? null)
      return
    }
    let alive = true
    void window.api.library.getCover(bookId).then(bytes => {
      if (!bytes) return
      const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
      cache.set(bookId, u)
      if (alive) setUrl(u)
    })
    return () => { alive = false }
  }, [bookId, hasCover])
  return url
}
