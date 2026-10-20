import type { ReviewCard } from '../../../shared/types'

const TAGS = { ai: 'Question', highlight: 'Highlight', note: 'Your note', word: 'Word', cloze: 'Highlight' } as const

interface Props {
  card: ReviewCard
  position: number
  total: number
  revealed: boolean
  onReveal: () => void
  onNext: () => void
  onSooner: () => void
  onOpen: () => void
}

function Source({ card }: { card: ReviewCard }) {
  if (!card.answer) return null
  return <blockquote className="review-quote" data-testid="review-source">{card.answer}</blockquote>
}

export function ReviewCardView({ card, position, total, revealed, onReveal, onNext, onSooner, onOpen }: Props) {
  const ai = card.promptType === 'ai'
  return (
    <div className="card review-card" data-testid="review-card" key={card.highlightId}>
      <div className="review-meta muted">
        <span>{card.bookTitle}{card.chapter ? ` · ${card.chapter}` : ''}</span>
        <span className="review-tag">{TAGS[card.promptType]}</span>
        {card.isNew && <span className="review-tag">New</span>}
        <span className="review-progress">{position} / {total}</span>
      </div>

      {ai ? (
        <div className="review-prompt" data-testid="review-prompt">{card.prompt}</div>
      ) : card.promptType === 'note' ? (
        <div className="review-usernote" data-testid="review-prompt">{card.prompt}</div>
      ) : (
        <>
          <blockquote className="review-quote review-quote-main" data-testid="review-prompt">{card.prompt}</blockquote>
          {card.note && <div className="review-note" data-testid="review-note">{card.note}</div>}
        </>
      )}

      {!revealed ? (
        <div className="review-footer">
          <div className="muted">Think of the answer, then press <b>Space</b></div>
          <button className="btn btn-primary" data-testid="review-reveal" onClick={onReveal}>Show Answer</button>
        </div>
      ) : (
        <div data-testid="review-answer">
          {ai && (
            <>
              <hr className="review-sep" />
              {card.aiAnswer && (
                <div className="review-ai">
                  <div className="review-label muted">Answer</div>
                  <div>{card.aiAnswer}</div>
                </div>
              )}
              <div className="review-label muted review-source-label">Source</div>
              <Source card={card} />
              {card.note && card.note !== card.answer && <div className="review-note">{card.note}</div>}
            </>
          )}
          <div className="review-rates">
            <button className="btn review-rate" data-testid="review-sooner" onClick={onSooner}>Sooner <kbd>S</kbd></button>
            <button className="btn btn-primary review-rate" data-testid="review-next" onClick={onNext}>Next <kbd>Space</kbd></button>
          </div>
          <div className="review-footer">
            <button className="btn btn-ghost" data-testid="review-open" onClick={onOpen}>Open in book <kbd>⌘O</kbd></button>
          </div>
        </div>
      )}
    </div>
  )
}
