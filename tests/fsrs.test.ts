import { describe, it, expect } from 'vitest';
import {
  newProgress,
  reapplyExamDate,
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


describe('reapplyExamDate', () => {
  /** Grow a card to a long interval with no exam set, so nothing is capped yet. */
  function matured(id: string) {
    let cur = newProgress(id, now);
    let at = now;
    for (let i = 0; i < 5; i++) {
      cur = review(cur, Rating.Easy, settings({ examDate: null }), at).progress;
      at = new Date(cur.due);
    }
    return cur;
  }

  it('pulls back cards that were already scheduled past a newly set exam', () => {
    // The original bug: capping only ran at rating time, so a card rated before
    // the date was set kept a due date after the exam — and the cards that
    // escaped were the well-known ones with the longest intervals.
    const card = matured('recap-1');
    const dueBefore = new Date(card.due);
    const exam = new Date(dueBefore.getTime() - 30 * 86_400_000);
    const examDate = exam.toISOString().slice(0, 10);

    const map = new Map([[card.cardId, card]]);
    const moved = reapplyExamDate(map, settings({ examDate }), now);

    expect(moved).toBe(1);
    const after = new Date(map.get('recap-1')!.due);
    expect(after.getTime()).toBeLessThan(dueBefore.getTime());
    expect(after.getTime()).toBeLessThan(exam.getTime());
  });

  it('restores the original interval when the exam is moved back out again', () => {
    // Recomputing from naturalDue rather than the capped value is what makes
    // this reversible; capping an already-capped date would ratchet intervals
    // permanently shorter with every edit.
    const card = matured('recap-2');
    const natural = new Date(card.due);
    const map = new Map([[card.cardId, card]]);

    const near = new Date(natural.getTime() - 40 * 86_400_000).toISOString().slice(0, 10);
    reapplyExamDate(map, settings({ examDate: near }), now);
    expect(new Date(map.get('recap-2')!.due).getTime()).toBeLessThan(natural.getTime());

    reapplyExamDate(map, settings({ examDate: null }), now);
    expect(new Date(map.get('recap-2')!.due).getTime()).toBe(natural.getTime());
  });

  it('does not ratchet intervals shorter across repeated edits', () => {
    const card = matured('recap-3');
    const natural = new Date(card.due);
    const map = new Map([[card.cardId, card]]);

    for (const offset of [40, 30, 50, 20]) {
      const d = new Date(natural.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
      reapplyExamDate(map, settings({ examDate: d }), now);
    }
    reapplyExamDate(map, settings({ examDate: null }), now);
    expect(new Date(map.get('recap-3')!.due).getTime()).toBe(natural.getTime());
  });

  it('leaves everything alone when capping is switched off', () => {
    const card = matured('recap-4');
    const natural = card.due;
    const map = new Map([[card.cardId, card]]);
    const examDate = new Date(new Date(natural).getTime() - 40 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    reapplyExamDate(map, settings({ examDate, capIntervalsAtExam: false }), now);
    expect(map.get('recap-4')!.due).toBe(natural);
  });

  it('ignores new cards, which are already due', () => {
    const fresh = newProgress('recap-5', now);
    const map = new Map([[fresh.cardId, fresh]]);
    const moved = reapplyExamDate(map, settings({ examDate: '2026-09-01' }), now);
    expect(moved).toBe(0);
  });

  it('backfills naturalDue for progress saved before it existed', () => {
    const card = matured('recap-6');
    delete card.naturalDue;
    const map = new Map([[card.cardId, card]]);
    reapplyExamDate(map, settings({ examDate: null }), now);
    expect(map.get('recap-6')!.naturalDue).toBeDefined();
  });
});
