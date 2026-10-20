// Writes a small text PDF (2 pages) with a valid xref table, used by e2e tests.
import { writeFileSync } from 'node:fs'

const pages = [
  'Spaced repetition strengthens memory over time.',
  'Retrieval practice beats rereading for durable learning.'
]
const objs = ['<< /Type /Catalog /Pages 2 0 R >>']
const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
const fontId = 3 + pages.length * 2
pages.forEach(text => {
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${objs.length + 2} 0 R >>`)
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
})
objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

let out = '%PDF-1.4\n'
const offsets = []
objs.forEach((o, i) => {
  offsets.push(out.length)
  out += `${i + 1} 0 obj\n${o}\nendobj\n`
})
const xref = out.length
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
out += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
writeFileSync(process.argv[2] ?? 'tests/fixtures/books/sample.pdf', out, 'latin1')
