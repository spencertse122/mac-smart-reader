import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setupWorkspace } from '../../src/main/setup/workspaceSetup'

const REAL_TEMPLATE = resolve(__dirname, '../../resources/workspace-template')
let root: string
let tpl: string

async function put(base: string, rel: string, content: string): Promise<void> {
  await mkdir(join(base, rel, '..'), { recursive: true })
  await writeFile(join(base, rel), content)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-ws-'))
  tpl = await mkdtemp(join(tmpdir(), 'sr-tpl-'))
  await put(tpl, 'root/CLAUDE.md', 'claude v1')
  await put(tpl, 'knowledge/index.md', 'index v1')
  await put(tpl, 'knowledge/prompts.jsonl', '')
  await put(tpl, 'skills/recall/SKILL.md', 'recall v1')
})

describe('setupWorkspace', () => {
  it('creates root files, knowledge files and skills in both agent dirs', async () => {
    const r = await setupWorkspace(root, tpl)
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('claude v1')
    expect(await readFile(join(root, 'knowledge/index.md'), 'utf8')).toBe('index v1')
    expect(existsSync(join(root, 'knowledge/prompts.jsonl'))).toBe(true)
    expect(await readFile(join(root, '.claude/skills/recall/SKILL.md'), 'utf8')).toBe('recall v1')
    expect(await readFile(join(root, '.agents/skills/recall/SKILL.md'), 'utf8')).toBe('recall v1')
    expect(r.created.sort()).toEqual(['.agents/skills/recall/SKILL.md', '.claude/skills/recall/SKILL.md', 'CLAUDE.md', 'knowledge/index.md', 'knowledge/prompts.jsonl'])
    expect(existsSync(join(root, '.smartreader/template-manifest.json'))).toBe(true)
  })

  it('is idempotent', async () => {
    await setupWorkspace(root, tpl)
    const r = await setupWorkspace(root, tpl)
    expect(r.created).toEqual([])
    expect(r.updated).toEqual([])
  })

  it('updates unedited managed files when the template changes', async () => {
    await setupWorkspace(root, tpl)
    await put(tpl, 'skills/recall/SKILL.md', 'recall v2')
    await put(tpl, 'root/CLAUDE.md', 'claude v2')
    const r = await setupWorkspace(root, tpl)
    expect(await readFile(join(root, '.claude/skills/recall/SKILL.md'), 'utf8')).toBe('recall v2')
    expect(r.updated).toContain('CLAUDE.md')
  })

  it('never clobbers user-edited managed files or any knowledge file', async () => {
    await setupWorkspace(root, tpl)
    await writeFile(join(root, 'CLAUDE.md'), 'my own notes')
    await writeFile(join(root, 'knowledge/index.md'), 'agent wrote this')
    await put(tpl, 'root/CLAUDE.md', 'claude v2')
    await put(tpl, 'knowledge/index.md', 'index v2')
    await setupWorkspace(root, tpl)
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('my own notes')
    expect(await readFile(join(root, 'knowledge/index.md'), 'utf8')).toBe('agent wrote this')
  })

  it('does not overwrite pre-existing files that were never written by the app', async () => {
    await put(root, 'CLAUDE.md', 'pre-existing user file')
    await setupWorkspace(root, tpl)
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('pre-existing user file')
  })

  it('creates empty concepts/ and books/ dirs from the real template', async () => {
    await setupWorkspace(root, REAL_TEMPLATE)
    expect(existsSync(join(root, 'knowledge/concepts'))).toBe(true)
    expect(existsSync(join(root, 'knowledge/books'))).toBe(true)
    for (const s of ['learning-coach', 'distill', 'preview', 'recall', 'drill', 'ask', 'weekly']) {
      expect(existsSync(join(root, `.claude/skills/${s}/SKILL.md`))).toBe(true)
    }
  })
})

describe('real template content', () => {
  it('bundled methodology matches docs/methodology.md', async () => {
    const a = await readFile(resolve(__dirname, '../../docs/methodology.md'), 'utf8')
    const b = await readFile(join(REAL_TEMPLATE, 'skills/learning-coach/methodology.md'), 'utf8')
    expect(b).toBe(a)
  })

  it('every SKILL.md has name + description frontmatter matching its folder', async () => {
    for (const s of ['learning-coach', 'distill', 'preview', 'recall', 'drill', 'ask', 'weekly']) {
      const md = await readFile(join(REAL_TEMPLATE, `skills/${s}/SKILL.md`), 'utf8')
      expect(md).toMatch(new RegExp(`^---\\nname: ${s}\\ndescription: .{20,}\\n`))
    }
  })
})
