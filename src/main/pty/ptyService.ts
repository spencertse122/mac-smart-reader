import { spawn, type IPty } from 'node-pty'
import { IPC } from '../../shared/ipc'
import { ptyEnv } from './env'

export class PtyService {
  private ptys = new Map<string, IPty>()
  private owners = new Map<string, number>() // pty id → webContents id that created it
  private seq = 0

  constructor(private send: (channel: string, ...args: unknown[]) => void) {}

  create(cwd: string, cols: number, rows: number, owner = 0): string {
    const id = `pty${++this.seq}`
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    // A login shell (-l) loads the user's profile so PATH includes claude/codex/gemini when launched from Finder.
    const p = spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd,
      env: ptyEnv(process.env)
    })
    p.onData(data => this.send(IPC.ptyData, id, data))
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id)
      this.owners.delete(id)
      this.send(IPC.ptyExit, id, exitCode)
    })
    this.ptys.set(id, p)
    this.owners.set(id, owner)
    return id
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.resize(Math.max(2, cols), Math.max(2, rows))
    } catch {
      // resizing a pty that just exited throws; safe to ignore
    }
  }

  kill(id: string): void {
    this.ptys.get(id)?.kill()
    this.ptys.delete(id)
    this.owners.delete(id)
  }

  // A reloaded or crashed page has lost its terminals' UI; don't leave their shells running unseen.
  killOwnedBy(owner: number): void {
    for (const [id, o] of [...this.owners]) if (o === owner) this.kill(id)
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }
}
