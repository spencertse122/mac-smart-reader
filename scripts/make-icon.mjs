import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync('build/icon.svg', 'utf8')
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng()
writeFileSync('build/icon.png', png)
console.log('wrote build/icon.png')
