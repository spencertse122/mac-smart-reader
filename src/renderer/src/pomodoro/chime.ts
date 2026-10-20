export function playChime(): void {
  try {
    const ctx = new AudioContext()
    const t0 = ctx.currentTime
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const t = t0 + i * 0.18
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.15, t + 0.04)
      gain.gain.linearRampToValueAtTime(0, t + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.18)
    })
    setTimeout(() => void ctx.close(), 600)
  } catch {
    // audio unavailable; ignore
  }
}
