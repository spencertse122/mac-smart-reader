import { Menu, type MenuItemConstructorOptions } from 'electron'
import { basename } from 'node:path'
import type { MenuAction } from '../shared/api'

export function buildMenu(send: (a: MenuAction) => void, recent: string[]): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'Shift+CmdOrCtrl+O', click: () => send({ type: 'open-folder' }) },
        {
          label: 'Open Recent',
          enabled: recent.length > 0,
          submenu: recent.map(path => ({ label: basename(path), sublabel: path, click: () => send({ type: 'open-library', path }) }))
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'New Note', accelerator: 'Shift+CmdOrCtrl+N', click: () => send({ type: 'new-note' }) },
        { label: 'Continue Reading', accelerator: 'CmdOrCtrl+B', click: () => send({ type: 'continue-reading' }) },
        { type: 'separator' },
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+J', click: () => send({ type: 'toggle-terminal' }) },
        { label: 'Start/Pause Pomodoro', accelerator: 'Alt+CmdOrCtrl+P', click: () => send({ type: 'toggle-pomodoro' }) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
