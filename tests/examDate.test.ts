import { describe, it, expect } from 'vitest';
import {
  daysUntilExam,
  desiredRetentionFor,
  capDueDate,
  requiredNewPerDay,
  RAMP_WINDOW_DAYS,
  MAX_RETENTION,
} from '../src/scheduler/examDate';

const at = (iso: string) => new Date(iso);

describe('daysUntilExam', () => {
  it('counts calendar days, not elapsed hours', () => {
    // Late at night the day before should still read as 1 day out.
    expect(daysUntilExam('2026-08-01', at('2026-07-31T23:30:00'))).toBe(1);
    expect(daysUntilExam('2026-08-01', at('2026-08-01T00:05:00'))).toBe(0);
  });

  it('goes negative after the exam', () => {
    expect(daysUntilExam('2026-08-01', at('2026-08-04T09:00:00'))).toBe(-3);
  });

  it('returns null with no exam set or a malformed date', () => {
    expect(daysUntilExam(null)).toBeNull();
    expect(daysUntilExam('not-a-date')).toBeNull();
  });
});

describe('desiredRetentionFor', () => {
  it('leaves retention at the base outside the ramp window', () => {
    expect(desiredRetentionFor(0.9, '2027-01-01', at('2026-07-25T12:00:00'))).toBe(0.9);
  });

  it('ramps upward as the exam approaches', () => {
    const far = desiredRetentionFor(0.9, '2026-09-23', at('2026-07-25T12:00:00')); // ~60d
    const near = desiredRetentionFor(0.9, '2026-08-04', at('2026-07-25T12:00:00')); // 10d
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(MAX_RETENTION);
  });

  it('caps at MAX_RETENTION on and after exam day', () => {
    expect(desiredRetentionFor(0.9, '2026-07-25', at('2026-07-25T08:00:00'))).toBe(MAX_RETENTION);
  });

  it('never ramps below the user base setting', () => {
    // A user who asked for 0.97 should keep it, not be dragged down to 0.95.
    expect(desiredRetentionFor(0.97, '2026-07-26', at('2026-07-25T08:00:00'))).toBe(0.97);
  });

  it('is a no-op without an exam date', () => {
    expect(desiredRetentionFor(0.88, null, at('2026-07-25T12:00:00'))).toBe(0.88);
  });

  it('is continuous at the window boundary', () => {
    const now = at('2026-07-25T12:00:00');
    const justOutside = new Date(now);
    justOutside.setDate(justOutside.getDate() + RAMP_WINDOW_DAYS + 1);
    const iso = justOutside.toISOString().slice(0, 10);
    expect(desiredRetentionFor(0.9, iso, now)).toBe(0.9);
  });
});

describe('capDueDate', () => {
  const now = at('2026-07-25T12:00:00');

  it('pulls a post-exam interval back inside the window', () => {
    const due = at('2026-09-01T12:00:00');
    const capped = capDueDate(due, now, '2026-08-10');
    expect(capped.getTime()).toBeLessThan(due.getTime());
    expect(capped.getTime()).toBeGreaterThan(now.getTime());
    // Lands the day before the exam.
    expect(capped.getFullYear()).toBe(2026);
    expect(capped.getMonth()).toBe(7); // August
    expect(capped.getDate()).toBe(9);
  });

  it('leaves an interval that already lands before the exam alone', () => {
    const due = at('2026-08-01T12:00:00');
    expect(capDueDate(due, now, '2026-08-10').getTime()).toBe(due.getTime());
  });

  it('stops capping once the exam has passed', () => {
    const due = at('2026-12-01T12:00:00');
    const after = at('2026-09-01T12:00:00');
    expect(capDueDate(due, after, '2026-08-10').getTime()).toBe(due.getTime());
  });

  it('is a no-op without an exam date', () => {
    const due = at('2027-01-01T12:00:00');
    expect(capDueDate(due, now, null).getTime()).toBe(due.getTime());
  });

  it('never schedules a card into the past', () => {
    const due = at('2026-09-01T12:00:00');
    // Exam is tomorrow: the last slot is today, which must still be >= now-ish.
    const capped = capDueDate(due, now, '2026-07-26');
    expect(capped.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});

describe('requiredNewPerDay', () => {
  it('spreads unseen cards over the days remaining', () => {
    expect(requiredNewPerDay(100, '2026-08-04', at('2026-07-25T12:00:00'))).toBe(10);
  });

  it('is zero when everything has been seen', () => {
    expect(requiredNewPerDay(0, '2026-08-04', at('2026-07-25T12:00:00'))).toBe(0);
  });

  it('is Infinity when the exam is here and cards remain unseen', () => {
    expect(requiredNewPerDay(50, '2026-07-25', at('2026-07-25T12:00:00'))).toBe(Infinity);
  });

  it('returns null with no exam date', () => {
    expect(requiredNewPerDay(50, null)).toBeNull();
  });
});
