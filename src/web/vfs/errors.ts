export type FsErrorCode = 'ENOENT' | 'EISDIR' | 'ENOTDIR' | 'EEXIST' | 'ENOTEMPTY' | 'EINVAL'

export function fsError(code: FsErrorCode, syscall: string, path: string): NodeJS.ErrnoException {
  const e = new Error(`${code}: ${syscall} '${path}'`) as NodeJS.ErrnoException
  e.code = code
  e.syscall = syscall
  e.path = path
  return e
}
