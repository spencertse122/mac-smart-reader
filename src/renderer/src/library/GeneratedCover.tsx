import { coverHue } from './metadata'

export function GeneratedCover({ id, title, author }: { id: string; title: string; author: string }) {
  const h = coverHue(id)
  return (
    <div className="gen-cover" style={{ background: `linear-gradient(160deg, hsl(${h} 45% 58%), hsl(${(h + 40) % 360} 50% 36%))` }}>
      <div className="gen-cover-title">{title}</div>
      {author && <div className="gen-cover-author">{author}</div>}
    </div>
  )
}
