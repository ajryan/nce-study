/**
 * Exam-date awareness.
 *
 * Plain FSRS optimises for retention at an indefinite horizon. Studying for a
 * dated exam is a different problem: retention matters on exactly one day, and
 * an interval that lands after that day is wasted scheduling.
 *
 * Two adjustments:
 *   1. Interval capping — nothing is allowed to come due after the exam.
 *   2. Retention ramp — as the exam nears, raise the target recall probability
 *      so cards are seen more often in the run-up.
 */

const DAY_MS = 86_400_000;

/** Days from `now` until the exam. Negative once the exam has passed. */
export function daysUntilExam(examDate: string | null, now: Date = new Date()): number | null {
  if (!examDate) return null;
  const exam = parseExamDate(examDate);
  if (!exam) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((exam.getTime() - startOfToday) / DAY_MS);
}

/** Parses yyyy-mm-dd as a *local* date so the countdown matches the calendar. */
export function parseExamDate(examDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(examDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Retention is ramped over the final stretch, not across the whole plan. */
export const RAMP_WINDOW_DAYS = 60;
export const MAX_RETENTION = 0.95;

/**
 * Target retention for today. Outside the ramp window (or with no exam set)
 * this is just the user's base setting; inside it, retention rises linearly
 * toward MAX_RETENTION on exam day.
 */
export function desiredRetentionFor(
  base: number,
  examDate: string | null,
  now: Date = new Date(),
): number {
  const days = daysUntilExam(examDate, now);
  if (days === null || days > RAMP_WINDOW_DAYS) return base;

  // The ramp only ever raises retention. A user who already asks for more than
  // MAX_RETENTION keeps their setting instead of being dragged down to it.
  const ceiling = Math.max(base, MAX_RETENTION);
  if (days <= 0) return ceiling;

  const progress = (RAMP_WINDOW_DAYS - days) / RAMP_WINDOW_DAYS;
  return base + (ceiling - base) * progress;
}

/**
 * Pull a due date back inside the exam window.
 *
 * A card scheduled past the exam gets reviewed once more the day before it
 * instead. Cards already due on or before the exam are left alone, and once
 * the exam has passed capping stops applying so the deck reverts to ordinary
 * long-term scheduling.
 */
export function capDueDate(due: Date, now: Date, examDate: string | null): Date {
  const exam = examDate ? parseExamDate(examDate) : null;
  if (!exam) return due;

  // End of the day before the exam — the last useful review slot.
  const lastSlot = new Date(exam.getTime() - DAY_MS);
  lastSlot.setHours(23, 59, 0, 0);

  if (lastSlot.getTime() <= now.getTime()) return due; // exam is here or past
  return due.getTime() > lastSlot.getTime() ? lastSlot : due;
}

export interface ReadinessInput {
  totalCards: number;
  /** Cards whose retrievability is at or above target on exam day. */
  strongCards: number;
  seenCards: number;
}

/**
 * A blunt readiness percentage for the dashboard.
 *
 * Deliberately conservative: unseen cards count fully against readiness,
 * because material never studied is the likeliest source of exam-day surprise.
 */
export function readinessPct({ totalCards, strongCards }: ReadinessInput): number {
  if (totalCards === 0) return 0;
  return Math.round((strongCards / totalCards) * 100);
}

/**
 * Cards per day needed to see every unseen card before the exam. Returns null
 * when there is no exam date, and Infinity when the exam is today or past with
 * cards still unseen.
 */
export function requiredNewPerDay(
  unseenCards: number,
  examDate: string | null,
  now: Date = new Date(),
): number | null {
  const days = daysUntilExam(examDate, now);
  if (days === null) return null;
  if (unseenCards <= 0) return 0;
  if (days <= 0) return Infinity;
  return Math.ceil(unseenCards / days);
}
