const lost = new Set<string>()
export const lostAnchors = {
  has: (id: string): boolean => lost.has(id),
  add: (id: string): void => void lost.add(id),
  delete: (id: string): void => void lost.delete(id)
}
