import { describe, it, expect } from 'vitest'
import { neuterBookScripts, stripScripts, type FoliateBook } from '../../src/renderer/src/reader/foliate'

describe('stripScripts', () => {
  it('removes script elements in every form and keeps the rest', () => {
    const html = '<head><script src="a.js"></script><SCRIPT type="text/javascript">\nparent.x=1\n</SCRIPT ><script src="b.js"/></head><body><p>Keep <b>me</b></p></body>'
    expect(stripScripts(html)).toBe('<head></head><body><p>Keep <b>me</b></p></body>')
  })
})

describe('neuterBookScripts', () => {
  const run = async (data: unknown, type: string): Promise<unknown> => {
    const target = new EventTarget()
    neuterBookScripts({ sections: [], transformTarget: target } as FoliateBook)
    const detail = { data, type }
    target.dispatchEvent(new CustomEvent('data', { detail }))
    return await detail.data
  }

  it('empties script resources and strips scripts from markup', async () => {
    expect(await run('parent.api.pty.create()', 'application/javascript')).toBe('')
    expect(await run(Promise.resolve('x()'), 'text/javascript')).toBe('')
    expect(await run('<p>a</p><script>x()</script>', 'application/xhtml+xml')).toBe('<p>a</p>')
    expect(await run('<svg><script>x()</script></svg>', 'image/svg+xml')).toBe('<svg></svg>')
  })

  it('leaves other resources alone', async () => {
    expect(await run('p { color: red }', 'text/css')).toBe('p { color: red }')
    const blob = new Blob(['x'])
    expect(await run(blob, 'image/png')).toBe(blob)
  })
})
