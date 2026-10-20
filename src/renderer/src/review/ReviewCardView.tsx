import type { Rating, ReviewCard } from '../../../shared/types'

const TAGS = { ai: 'AI question', note: 'Your question', cloze: 'Fill in the blank' } as const
const RATINGS: Array<{ rating: Rating; label: string; key: number }> = [
  { rating: 'again', label: 'Again', key: 1 },
  { rating: 'hard', label: 'Hard', key: 2 },
  { rating: 'good', label: 'Good', key: 3 },
  { rating: 'easy', label: 'Easy', key: 4 }
]

function renderPrompt(card: ReviewCard) {
  if (card.promptType !== 'cloze') return card.prompt
  return card.prompt.split(/(▁▁▁▁(?: \(~\d+ words?\))?)/).map((part, i) =>
    part.startsWith('▁▁▁▁') ? <span key={i} className="review-blank">{part}</span> : part
  )
}

interface Props {
  card: ReviewCard
  position: number
  total: number
  revealed: boolean
  onReveal: () => void
  onRate: (r: Rating) => void
  onOpen: () => void
}

export function ReviewCardView({ card, position, total, revealed, onReveal, onRate, onOpen }: Props) {
  return (
    <div className="card review-card" data-testid="review-card" key={card.highlightId}>
      <div className="review-meta muted">
        <span>{card.bookTitle}{card.chapter ? ` · ${card.chapter}` : ''}</span>
        <span className="review-tag">{TAGS[card.promptType]}</span>
        {card.isNew && <span className="review-tag">New</span>}
        <span className="review-progress">{position} / {total}</span>
      </div>
      <div className="review-prompt" data-testid="review-prompt">{renderPrompt(card)}</div>
      {!revealed ? (
        <div className="review-footer">
          <div className="muted">Recall it, then press <b>Space</b></div>
          <button className="btn btn-primary" data-testid="review-reveal" onClick={onReveal}>Show Answer</button>
        </div>
      ) : (
        <div data-testid="review-answer">
          <hr className="review-sep" />
          <div className="review-answer">{card.answer}</div>
          {card.note && <div className="review-note">{card.note}</div>}
          {card.aiAnswer && (
            <div className="review-ai">
              <div className="review-label muted">Model answer</div>
              <div>{card.aiAnswer}</div>
            </div>
          )}
          <div className="review-rates">
            {RATINGS.map(r => (
              <button key={r.rating} className={`btn review-rate rate-${r.rating}`} data-testid={`rate-${r.rating}`} onClick={() => onRate(r.rating)}>
                {r.label} <kbd>{r.key}</kbd>
              </button>
            ))}
          </div>
          <div className="review-footer">
            <button className="btn btn-ghost" data-testid="review-open" onClick={onOpen}>Open in book <kbd>⌘O</kbd></button>
          </div>
        </div>
      )}
    </div>
  )
}
