import { it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, appendFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePromptLines, PromptWatcher } from '../../src/main/review/prompts'

it('keeps the last valid line per highlight and counts invalid objects', () => {
  const r = parsePromptLines([
    { highlightId: 'h_1', question: 'Q1' },
    { highlightId: 'h_1', question: 'Q1 better', answer: 'A' },
    { highlightId: 'h_2' },
    { question: 'no id' },
    { highlightId: 'h_3', question: '   ' }
  ])
  expect(r.prompts.get('h_1')).toEqual({ highlightId: 'h_1', question: 'Q1 better', answer: 'A' })
  expect(r.prompts.size).toBe(1)
  expect(r.invalid).toBe(3)
})

it('partial trailing line is skipped then picked up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-pr-'))
  const file = join(dir, 'prompts.jsonl')
  await writeFile(file, '{"highlightId":"h_1","question":"Q1"}\n{"highlightId":"h_2","quest')
  const onChange = vi.fn()
  const w = new PromptWatcher(file, onChange)
  await w.load()
  expect(w.get('h_1')?.question).toBe('Q1')
  expect(w.get('h_2')).toBeUndefined()
  expect(w.invalidLines).toBe(1)
  w.start(50)
  await appendFile(file, 'ion":"Q2"}\n')
  await vi.waitFor(() => expect(w.get('h_2')?.question).toBe('Q2'), { timeout: 3000 })
  expect(onChange).toHaveBeenCalled()
  expect(w.invalidLines).toBe(0)
  w.stop()
})

it('survives the file being replaced via rename and being absent at start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-pr-'))
  const file = join(dir, 'prompts.jsonl')
  const w = new PromptWatcher(file)
  await w.load()
  expect(w.ids()).toEqual([])
  w.start(50)
  await writeFile(join(dir, 'tmp'), '{"highlightId":"h_9","question":"Q9"}\n')
  await rename(join(dir, 'tmp'), file)
  await vi.waitFor(() => expect(w.get('h_9')?.question).toBe('Q9'), { timeout: 3000 })
  w.stop()
})
