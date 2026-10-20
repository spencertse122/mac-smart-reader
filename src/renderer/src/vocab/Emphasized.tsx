import { emphasize } from './text'

export function Emphasized({ sentence, terms }: { sentence: string; terms: Array<string | null | undefined> }) {
  return (
    <>
      {emphasize(sentence, terms).map((s, i) => (s.hit ? <mark key={i} className="vocab-em">{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  )
}
