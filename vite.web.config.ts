import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webAliases } from './web.aliases'

export default defineConfig({
  root: 'src/web',
  publicDir: '../renderer/public',
  plugins: [react()],
  resolve: { alias: webAliases },
  define: { 'process.env': '{}', 'process.pid': '1' },
  build: { outDir: '../../out/web', emptyOutDir: true }
})
