import { createEmptyCard, fsrs, generatorParameters, Rating as FsrsRating, type Card, type FSRS, type Grade, type State } from 'ts-fsrs'
import type { CardState, FsrsState, Rating } from '../../shared/types'

const GRADE: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy
}

const schedulers = new Map<number, FSRS>()
function scheduler(retention: number): FSRS {
  let s = schedulers.get(retention)
  if (!s) {
    s = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: false }))
    schedulers.set(retention, s)
  }
  return s
}

function toFsrs(c: CardState): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review) : undefined
  } as Card
}

function fromFsrs(card: Card, bookId: string, suspended: boolean): CardState {
  return {
    bookId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as FsrsState,
    last_review: card.last_review ? card.last_review.toISOString() : null,
    suspended
  }
}

export function newCardState(bookId: string, due: Date): CardState {
  return fromFsrs(createEmptyCard(due), bookId, false)
}

export function schedule(c: CardState, rating: Rating, now: Date, retention = 0.9): CardState {
  const { card } = scheduler(retention).next(toFsrs(c), now, GRADE[rating])
  return fromFsrs(card, c.bookId, c.suspended)
}

// Never-reviewed cards count as 0: exposure is not retention.
export function retrievability(c: CardState, now: Date, retention = 0.9): number {
  if (c.state === 0 || c.reps === 0) return 0
  return scheduler(retention).get_retrievability(toFsrs(c), now, false)
}
