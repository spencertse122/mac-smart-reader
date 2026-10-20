export function formatRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(1)
  return `${v < 0 ? '−' : ''}${s} / hr`
}

export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  if (d1 === d0) return () => (r0 + r1) / 2
  return v => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)
}
