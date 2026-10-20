export function TerminalPanel({ visible }: { visible: boolean }) {
  return visible ? <div className="placeholder" data-testid="terminal-panel">Terminal</div> : null
}
