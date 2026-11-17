import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { webAliases } from './web.aliases'

const EXTRA = resolve('src/web/public-extra')
const TYPES: Record<string, string> = {
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

// The renderer's public/ is shared with Electron, so web-only files (manifest, home-screen icons)
// live in src/web/public-extra and are served/copied at the site root by this plugin.
function publicExtra(): Plugin {
  let cached: string[] | null = null
  const files = (): string[] => (cached ??= readdirSync(EXTRA))
  return {
    name: 'smart-reader-public-extra',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!files().includes(name)) return next()
        res.setHeader('Content-Type', TYPES[extname(name)] ?? 'application/octet-stream')
        res.end(readFileSync(join(EXTRA, name)))
      })
    },
    generateBundle() {
      for (const name of files()) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(join(EXTRA, name)) })
    }
  }
}

export default defineConfig({
  root: 'src/web',
  publicDir: '../renderer/public',
  plugins: [react(), publicExtra()],
  resolve: { alias: webAliases },
  define: { 'process.env': '{}', 'process.pid': '1' },
  build: { outDir: '../../out/web', emptyOutDir: true }
})
