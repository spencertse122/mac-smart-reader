import { resolve } from 'node:path'

// Only node:-prefixed imports are aliased: src/main uses them everywhere, and tests keep the real bare `fs`/`path`.
// Exact-match regexes so `node:fs` never swallows `node:fs/promises` whatever the order.
export const webAliases = [
  { find: /^node:fs\/promises$/, replacement: resolve('src/web/vfs/fsPromises.ts') },
  { find: /^node:fs$/, replacement: resolve('src/web/vfs/fs.ts') },
  { find: /^node:path$/, replacement: resolve('src/web/shims/path.ts') },
  { find: /^node:crypto$/, replacement: resolve('src/web/shims/crypto.ts') },
  { find: /^node:os$/, replacement: resolve('src/web/shims/os.ts') }
]
