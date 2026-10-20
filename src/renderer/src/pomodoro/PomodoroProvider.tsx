import type { ReactNode } from 'react'

export type PomodoroPhase = 'idle' | 'work' | 'break' | 'longBreak'

export function PomodoroProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function PomodoroControl() {
  return null
}

export function usePomodoro(): { phase: PomodoroPhase; running: boolean; toggle(): void } {
  return { phase: 'idle', running: false, toggle: () => {} }
}
