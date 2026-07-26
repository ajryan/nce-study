import { describe, it, expect } from 'vitest';
import {
  newProgress,
  review,
  deriveRating,
  previewIntervals,
  isDue,
  isNew,
  Rating,
  State,
  DEFAULT_SETTINGS,
  type SchedulerSettings,
} from '../src/scheduler/fsrs';

const settings = (patch: Partial<SchedulerSettings> = {}): SchedulerSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

const now = new Date('2026-07-25T12:00:00Z');

describe('deriveRating', () => {
  it('maps a wrong answer to Again regardless of self-rating', () => {
    expect(deriveRating(false)).toBe(Rating.Again);
    expect(deriveRating(false, Rating.Easy)).toBe(Rating.Again);
  });

  it('defaults a correct answer to Good', () => {
    expect(deriveRating(true)).toBe(Rating.Good);
  });

  it('honours an explicit self-rating when correct', () => {
    expect(deriveRating(true, Rating.Hard)).toBe(Rating.Hard);
    expect(deriveRating(true, Rating.Easy)).toBe(Rating.Easy);
  });
});

describe('review', () => {
  it('advances a new card out of the New state', () => {
    const p = newProgress('card-1', now);
    expect(isNew(p)).toBe(true);

    const { progress } = review(p, Rating.Good, settings(), now);
    expect(progress.state).not.toBe(State.New);
    expect(progress.reps).toBe(1);
    expect(new Date(progress.due).getTime()).toBeGreaterThan(now.getTime());
  });

  it('produces longer intervals for Easy than for Hard', () => {
    const p = newProgress('card-2', now);
    // Get the card into review state first.
    const seeded = review(p, Rating.Good, settings(), now).progress;
    const later = new Date(now.getTime() + 10 * 86_400_000);

    const hard = review(seeded, Rating.Hard, settings(), later).intervalDays;
    const easy = review(seeded, Rating.Easy, settings(), later).intervalDays;
    expect(easy).toBeGreaterThan(hard);
  });

  it('counts a lapse and shortens the interval when rated Again', () => {
    const p = newProgress('card-3', now);
    let cur = review(p, Rating.Good, settings(), now).progress;
    const t1 = new Date(now.getTime() + 5 * 86_400_000);
    cur = review(cur, Rating.Good, settings(), t1).progress;

    const t2 = new Date(t1.getTime() + 20 * 86_400_000);
    const good = review(cur, Rating.Good, settings(), t2);
    const again = review(cur, Rating.Again, settings(), t2);

    expect(again.intervalDays).toBeLessThan(good.intervalDays);
    expect(again.progress.lapses).toBeGreaterThan(cur.lapses);
  });

  it('tracks correctness counts', () => {
    const p = newProgress('card-4', now);
    const first = review(p, Rating.Good, settings(), now, true).progress;
    expect(first.answerCount).toBe(1);
    expect(first.correctCount).toBe(1);

    const second = review(first, Rating.Again, settings(), now, false).progress;
    expect(second.answerCount).toBe(2);
    expect(second.correctCount).toBe(1);
  });

  it('infers correctness from the rating when not supplied', () => {
    const p = newProgress('card-5', now);
    const good = review(p, Rating.Good, settings(), now).progress;
    expect(good.correctCount).toBe(1);

    const bad = review(p, Rating.Again, settings(), now).progress;
    expect(bad.correctCount).toBe(0);
  });

  /** Grows a card to a long, stable interval by acing it repeatedly. */
  function matureCard(id: string) {
    let cur = newProgress(id, now);
    let at = now;
    for (let i = 0; i < 5; i++) {
      cur = review(cur, Rating.Easy, settings(), at).progress;
      at = new Date(cur.due); // advance to when the card actually comes due
    }
    return { progress: cur, at };
  }

  it('caps the interval at the exam date and reports that it did', () => {
    const { progress: mature, at } = matureCard('card-6');

    const uncapped = review(mature, Rating.Easy, settings({ examDate: null }), at);
    expect(uncapped.cappedByExam).toBe(false);
    expect(uncapped.intervalDays).toBeGreaterThan(30); // precondition

    // Put the exam well inside that natural interval.
    const examDate = new Date(at.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
    const capped = review(
      mature,
      Rating.Easy,
      settings({ examDate, capIntervalsAtExam: true, rampRetention: false }),
      at,
    );

    expect(capped.cappedByExam).toBe(true);
    expect(capped.intervalDays).toBeLessThan(uncapped.intervalDays);
    expect(new Date(capped.progress.due).getTime()).toBeLessThan(
      new Date(`${examDate}T00:00:00`).getTime(),
    );
  });

  it('does not cap when capping is disabled', () => {
    const { progress: mature, at } = matureCard('card-7');
    const examDate = new Date(at.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
    const result = review(mature, Rating.Easy, settings({ examDate, capIntervalsAtExam: false }), at);
    expect(result.cappedByExam).toBe(false);
  });

  it('survives the clock jumping backwards mid-schedule', () => {
    // DST shifts, timezone changes and NTP corrections can all move `now`
    // behind a card's last_review. FSRS rejects a negative elapsed time, so
    // this must clamp rather than throw and lose the user's answer.
    const p = newProgress('card-clock', now);
    const reviewed = review(p, Rating.Good, settings(), now).progress;
    const backwards = new Date(now.getTime() - 52 * 86_400_000);

    expect(() => review(reviewed, Rating.Good, settings(), backwards)).not.toThrow();
    expect(() => previewIntervals(reviewed, settings(), backwards)).not.toThrow();
    expect(review(reviewed, Rating.Good, settings(), backwards).progress.reps).toBe(2);
  });
});

describe('previewIntervals', () => {
  it('offers a monotonic interval ladder across the four ratings', () => {
    const p = newProgress('card-8', now);
    const seeded = review(p, Rating.Good, settings(), now).progress;
    const later = new Date(now.getTime() + 3 * 86_400_000);

    const preview = previewIntervals(seeded, settings(), later);
    expect(preview[Rating.Again]).toBeLessThanOrEqual(preview[Rating.Hard]);
    expect(preview[Rating.Hard]).toBeLessThanOrEqual(preview[Rating.Good]);
    expect(preview[Rating.Good]).toBeLessThanOrEqual(preview[Rating.Easy]);
  });
});

describe('isDue', () => {
  it('is true once the due date has passed', () => {
    const p = newProgress('card-9', now);
    expect(isDue(p, now)).toBe(true); // new cards are due immediately
  });

  it('is false for a suspended card even when due', () => {
    const p = { ...newProgress('card-10', now), suspended: true };
    expect(isDue(p, now)).toBe(false);
  });

  it('is false before the due date', () => {
    const p = newProgress('card-11', now);
    const scheduled = review(p, Rating.Easy, settings(), now).progress;
    expect(isDue(scheduled, now)).toBe(false);
  });
});
