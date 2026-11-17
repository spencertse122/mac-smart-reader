import { resolve } from 'node:path'

// Only node:-prefixed imports are aliased: src/main uses them everywhere, and tests keep the real bare `fs`/`path`.
export const webAliases = {
  'node:fs/promises': resolve('src/web/vfs/fsPromises.ts'),
  'node:fs': resolve('src/web/vfs/fs.ts'),
  'node:path': resolve('src/web/shims/path.ts'),
  'node:crypto': resolve('src/web/shims/crypto.ts'),
  'node:os': resolve('src/web/shims/os.ts')
}
