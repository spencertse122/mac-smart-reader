import { defineConfig } from 'vitest/config'
import { webAliases } from './web.aliases'

export default defineConfig({
  resolve: { alias: webAliases },
  test: { include: ['tests/web/**/*.test.ts'], environment: 'node', setupFiles: ['fake-indexeddb/auto'] }
})
