// Web app icons for the manifest and iOS home screen, from the same artwork as the Mac icon.
// Usage: node scripts/make-web-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const OUT = 'src/web/public-extra'
const svg = readFileSync('build/icon.svg', 'utf8')
// Home screens mask icons themselves, so crop to the tile and square its corners (full bleed).
const square = svg
  .replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"')
  .replaceAll('rx="230"', 'rx="0"')

const render = (src, size) => new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng()
const files = {
  'icon-192.png': render(square, 192),
  'icon-512.png': render(square, 512),
  'apple-touch-icon.png': render(square, 180),
  'favicon-32.png': render(svg, 32)
}
for (const [name, png] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, png)
writeFileSync(`${OUT}/favicon.svg`, svg)
console.log(`wrote ${Object.keys(files).length + 1} icons to ${OUT}`)
