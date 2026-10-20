import type { ITheme } from '@xterm/xterm'

export const WELCOME_LINE =
  '\x1b[2mSmart Reader · this terminal opens in your books folder. Run \x1b[0m\x1b[1mclaude\x1b[0m\x1b[2m, \x1b[0m\x1b[1mcodex\x1b[0m\x1b[2m or \x1b[0m\x1b[1mgemini\x1b[0m\x1b[2m to start your coach (try "distill my new highlights").\x1b[0m\r\n'

export function xtermTheme(dark: boolean): ITheme {
  return dark
    ? {
        background: '#1c1c1e', foreground: '#e5e5ea', cursor: '#0a84ff', selectionBackground: '#0a84ff55',
        black: '#1c1c1e', red: '#ff6961', green: '#7ee787', yellow: '#ffd60a', blue: '#64a8ff', magenta: '#d2a8ff',
        cyan: '#76e4f7', white: '#e5e5ea', brightBlack: '#6e6e73', brightWhite: '#ffffff'
      }
    : {
        background: '#fbfbfd', foreground: '#1d1d1f', cursor: '#0a84ff', selectionBackground: '#0a84ff33',
        black: '#1d1d1f', red: '#d70015', green: '#248a3d', yellow: '#a05a00', blue: '#0040dd', magenta: '#8944ab',
        cyan: '#0071a4', white: '#6e6e73', brightBlack: '#8e8e93', brightWhite: '#1d1d1f'
      }
}
