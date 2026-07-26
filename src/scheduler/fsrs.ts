/**
 * FSRS wrapper.
 *
 * ts-fsrs owns the memory model (difficulty / stability / retrievability); this
 * module owns everything around it: serialisation, rating derivation from MCQ
 * outcomes, and the exam-date adjustments.
 */
import {
  fsrs,
  createEmptyCard,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
} from 'ts-fsrs';
import { desiredRetentionFor, capDueDate } from './examDate';

export { Rating, State };
export type { FsrsCard };

export interface SchedulerSettings {
  /** Base target probability of recall. FSRS default is 0.90. */
  desiredRetention: number;
  /** ISO date (yyyy-mm-dd) of the exam, or null if not set. */
  examDate: string | null;
  /** Ramp retention upward as the exam approaches. */
  rampRetention: boolean;
  /** Never schedule a card past the exam. */
  capIntervalsAtExam: boolean;
  maxNewPerDay: number;
  maxReviewsPerDay: number;
  /** Mix domains within a session rather than blocking by topic. */
  interleave: boolean;
}

export const DEFAULT_SETTINGS: SchedulerSettings = {
  desiredRetention: 0.9,
  examDate: null,
  rampRetention: true,
  capIntervalsAtExam: true,
  maxNewPerDay: 20,
  maxReviewsPerDay: 200,
  interleave: true,
};

/** Persisted per-card scheduling state. */
export interface CardProgress {
  cardId: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  state: State;
  last_review?: string;
  /** Answer history summary, used by the dashboard. */
  correctCount: number;
  answerCount: number;
  suspended?: boolean;
}

export function newProgress(cardId: string, now: Date = new Date()): CardProgress {
  return toProgress(cardId, createEmptyCard(now), 0, 0);
}

export function toProgress(
  cardId: string,
  card: FsrsCard,
  correctCount: number,
  answerCount: number,
  suspended = false,
): CardProgress {
  return {
    cardId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
    ...(card.last_review ? { last_review: card.last_review.toISOString() } : {}),
    correctCount,
    answerCount,
    suspended,
  };
}

export function toFsrsCard(p: CardProgress): FsrsCard {
  return {
    due: new Date(p.due),
    stability: p.stability,
    difficulty: p.difficulty,
    elapsed_days: p.elapsed_days,
    scheduled_days: p.scheduled_days,
    reps: p.reps,
    lapses: p.lapses,
    learning_steps: p.learning_steps,
    state: p.state,
    ...(p.last_review ? { last_review: new Date(p.last_review) } : {}),
  } as FsrsCard;
}

/**
 * MCQ outcomes carry more signal than a self-report: getting an item wrong is
 * unambiguous evidence of failed retrieval, so it always maps to Again. A
 * correct answer defaults to Good, with Hard/Easy left available to the user
 * for "I guessed" and "instant" respectively.
 */
export function deriveRating(correct: boolean, selfRating?: Grade): Grade {
  if (!correct) return Rating.Again;
  return selfRating ?? Rating.Good;
}

export function buildScheduler(settings: SchedulerSettings, now: Date = new Date()): FSRS {
  const retention = settings.rampRetention
    ? desiredRetentionFor(settings.desiredRetention, settings.examDate, now)
    : settings.desiredRetention;

  return fsrs(
    generatorParameters({
      request_retention: retention,
      enable_fuzz: true,
      enable_short_term: true,
    }),
  );
}

export interface ReviewResult {
  progress: CardProgress;
  /** Days until this card is next due, for immediate UI feedback. */
  intervalDays: number;
  /** True when the exam date pulled the interval in. */
  cappedByExam: boolean;
}

/**
 * FSRS rejects a review dated before the card's last review (it would imply a
 * negative elapsed time). A backwards jump in the system clock — DST, a
 * timezone change while travelling, an NTP correction — would otherwise throw
 * mid-session and lose the answer, so clamp instead.
 */
function safeNow(progress: CardProgress, now: Date): Date {
  if (!progress.last_review) return now;
  const last = new Date(progress.last_review);
  return now.getTime() < last.getTime() ? last : now;
}

export function review(
  progress: CardProgress,
  rating: Grade,
  settings: SchedulerSettings,
  nowInput: Date = new Date(),
  wasCorrect?: boolean,
): ReviewResult {
  const now = safeNow(progress, nowInput);
  const scheduler = buildScheduler(settings, now);
  const { card } = scheduler.next(toFsrsCard(progress), now, rating);

  let due = card.due;
  let cappedByExam = false;

  if (settings.capIntervalsAtExam && settings.examDate) {
    const capped = capDueDate(due, now, settings.examDate);
    if (capped.getTime() !== due.getTime()) {
      due = capped;
      cappedByExam = true;
    }
  }

  const correct = wasCorrect ?? rating !== Rating.Again;

  const next = toProgress(
    progress.cardId,
    { ...card, due },
    progress.correctCount + (correct ? 1 : 0),
    progress.answerCount + 1,
    progress.suspended ?? false,
  );

  return {
    progress: next,
    intervalDays: Math.max(0, (due.getTime() - now.getTime()) / 86_400_000),
    cappedByExam,
  };
}

/** Preview the interval each rating would produce, for the answer buttons. */
export function previewIntervals(
  progress: CardProgress,
  settings: SchedulerSettings,
  nowInput: Date = new Date(),
): Record<Grade, number> {
  const now = safeNow(progress, nowInput);
  const scheduler = buildScheduler(settings, now);
  const scheduled = scheduler.repeat(toFsrsCard(progress), now);
  const out = {} as Record<Grade, number>;
  for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    let due = scheduled[grade].card.due;
    if (settings.capIntervalsAtExam && settings.examDate) {
      due = capDueDate(due, now, settings.examDate);
    }
    out[grade] = Math.max(0, (due.getTime() - now.getTime()) / 86_400_000);
  }
  return out;
}

export function isDue(progress: CardProgress, now: Date = new Date()): boolean {
  return !progress.suspended && new Date(progress.due).getTime() <= now.getTime();
}

export function isNew(progress: CardProgress): boolean {
  return progress.state === State.New;
}
