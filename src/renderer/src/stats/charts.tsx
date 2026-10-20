import { useEffect, useRef, useState } from 'react'
import { scaleLinear } from './format'

export interface Point { label: string; value: number }

const PAD = { l: 34, r: 8, t: 8, b: 20 }

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, w }
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function Tip({ x, y, w, text }: { x: number; y: number; w: number; text: string }) {
  const left = Math.min(Math.max(x, 40), Math.max(40, w - 40))
  return <div className="chart-tip" style={{ left, top: Math.max(0, y - 8) }}>{text}</div>
}

function YAxis({ ticks, y, w }: { ticks: number[]; y: (v: number) => number; w: number }) {
  return (
    <g>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--separator)" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart-label">{fmt(t)}</text>
        </g>
      ))}
    </g>
  )
}

export function LineChart({ points, height }: { points: Point[]; height: number }) {
  const { ref, w } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map(p => p.value))
  const min = Math.min(0, ...points.map(p => p.value))
  const y = scaleLinear([min, max], [height - PAD.b, PAD.t])
  const x = scaleLinear([0, Math.max(1, points.length - 1)], [PAD.l, Math.max(PAD.l + 1, w - PAD.r)])
  const ticks = [min, (min + max) / 2, max]
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')
  const area = points.length ? `${line} L${x(points.length - 1)},${y(min)} L${x(0)},${y(min)} Z` : ''
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!points.length) return
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - PAD.l) / Math.max(1, w - PAD.l - PAD.r)) * (points.length - 1))
    setHover(Math.min(points.length - 1, Math.max(0, i)))
  }
  const hp = hover !== null ? points[hover] : null
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Line chart">
          <YAxis ticks={ticks} y={y} w={w} />
          {points.length > 0 && <path d={area} fill="var(--accent-soft)" />}
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={3} fill="var(--accent)" />)}
          {points.length > 0 && (
            <>
              <text x={PAD.l} y={height - 5} className="chart-label">{points[0].label}</text>
              <text x={w - PAD.r} y={height - 5} textAnchor="end" className="chart-label">{points[points.length - 1].label}</text>
            </>
          )}
          {hp && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} stroke="var(--text-3)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(hp.value)} r={4} fill="var(--accent)" stroke="var(--bg-elevated)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hp && hover !== null && <Tip x={x(hover)} y={y(hp.value)} w={w} text={`${hp.label}: ${fmt(hp.value)}`} />}
    </div>
  )
}

export function BarChart({ bars, height, highlightLast }: { bars: Point[]; height: number; highlightLast?: boolean }) {
  const { ref, w } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...bars.map(b => b.value))
  const y = scaleLinear([0, max], [height - PAD.b, PAD.t])
  const innerW = Math.max(1, w - PAD.l - PAD.r)
  const slot = bars.length ? innerW / bars.length : innerW
  const bw = Math.max(2, Math.min(28, slot - 2))
  const r = 3
  const ticks = [0, max / 2, max]
  const labelIdx = bars.length ? [...new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1])] : []
  const cx = (i: number) => PAD.l + slot * i + slot / 2
  const hb = hover !== null ? bars[hover] : null
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} onMouseLeave={() => setHover(null)} role="img" aria-label="Bar chart">
          <YAxis ticks={ticks} y={y} w={w} />
          {bars.map((b, i) => {
            const top = y(b.value)
            const base = height - PAD.b
            const h = base - top
            const x0 = cx(i) - bw / 2
            const rr = Math.min(r, h, bw / 2)
            const d = h <= 0 ? '' : `M${x0},${base} V${top + rr} Q${x0},${top} ${x0 + rr},${top} H${x0 + bw - rr} Q${x0 + bw},${top} ${x0 + bw},${top + rr} V${base} Z`
            const full = highlightLast && i === bars.length - 1
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={cx(i) - slot / 2} y={PAD.t} width={slot} height={height - PAD.t - PAD.b} fill="transparent" />
                <path d={d} fill="var(--accent)" opacity={full || hover === i ? 1 : 0.75} />
              </g>
            )
          })}
          {labelIdx.map((i, k) => (
            <text key={i} x={cx(i)} y={height - 5} className="chart-label"
              textAnchor={k === 0 && labelIdx.length > 1 ? 'start' : k === labelIdx.length - 1 && labelIdx.length > 1 ? 'end' : 'middle'}>
              {bars[i].label}
            </text>
          ))}
        </svg>
      )}
      {hb && hover !== null && <Tip x={cx(hover)} y={y(hb.value)} w={w} text={`${hb.label}: ${fmt(hb.value)}`} />}
    </div>
  )
}
