// Which Drive paths the web mirrors, and which local files may be uploaded.

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

// Atomic-write temp files and .bak copies are the writer's local safety net; .corrupt-* copies are pushed (BC9).
export function isPushable(path: string): boolean {
  const name = base(path)
  return !/\.tmp-/.test(name) && !name.endsWith('.bak')
}

const SKIP_DIRS = new Set(['knowledge', 'node_modules'])

// relPath is relative to the library root. Mirrors scanFolder's walk, plus all of .smartreader/
// and the top level of knowledge/ (the app only reads knowledge/prompts.jsonl).
export function shouldIndex(relPath: string, isDir: boolean): boolean {
  const parts = relPath.split('/').filter(Boolean)
  if (parts.length === 0) return true
  if (parts[0] === '.smartreader') return true
  if (parts[0] === 'knowledge') return parts.length === 1 ? isDir : parts.length === 2 && !isDir
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('.')) return false
    const dir = i < parts.length - 1 || isDir
    if (dir && SKIP_DIRS.has(parts[i])) return false
  }
  return true
}
