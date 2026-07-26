import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore, __setStore, isDurable, type KeyValueStore, type StorageTier } from '../src/storage/db';
import { ProgressRepository, todayKey } from '../src/storage/progress';
import { newProgress, review, Rating, DEFAULT_SETTINGS } from '../src/scheduler/fsrs';
import { serializeBackup, parseBackup, BackupParseError, BACKUP_VERSION } from '../src/storage/backup';

const now = new Date('2026-07-25T12:00:00Z');

/** A store that fails writes, standing in for a blocked file:// origin. */
class BrokenStore implements KeyValueStore {
  readonly tier: StorageTier = 'indexeddb';
  async get<T>(): Promise<T | undefined> {
    return undefined;
  }
  async set(): Promise<void> {
    throw new Error('QuotaExceededError');
  }
  async delete(): Promise<void> {}
  async clear(): Promise<void> {}
}

describe('isDurable', () => {
  it('flags only the memory tier as non-durable', () => {
    expect(isDurable('indexeddb')).toBe(true);
    expect(isDurable('localstorage')).toBe(true);
    expect(isDurable('memory')).toBe(false);
  });
});

describe('MemoryStore', () => {
  it('round-trips values and clears', async () => {
    const store = new MemoryStore();
    await store.set('a', { x: 1 });
    expect(await store.get('a')).toEqual({ x: 1 });
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();

    await store.set('b', 2);
    await store.clear();
    expect(await store.get('b')).toBeUndefined();
  });
});

describe('ProgressRepository', () => {
  let repo: ProgressRepository;

  beforeEach(async () => {
    __setStore(new MemoryStore());
    repo = new ProgressRepository();
    await repo.load();
  });

  it('reports the tier it landed on', () => {
    expect(repo.tier).toBe('memory');
  });

  it('creates progress for new cards and drops orphans', () => {
    repo.ensureCards(['a', 'b', 'c'], now);
    expect(repo.getProgress().size).toBe(3);

    repo.ensureCards(['a', 'b'], now);
    expect(repo.getProgress().size).toBe(2);
    expect(repo.getCard('c')).toBeUndefined();
  });

  it('does not reset progress for cards that already exist', async () => {
    repo.ensureCards(['a'], now);
    const advanced = review(repo.getCard('a')!, Rating.Good, DEFAULT_SETTINGS, now).progress;
    await repo.recordReview(advanced, {
      cardId: 'a', at: now.toISOString(), rating: Rating.Good, correct: true, domain: 'D1', elapsedMs: 1000,
    }, true);

    repo.ensureCards(['a', 'b'], now);
    expect(repo.getCard('a')!.reps).toBe(1);
  });

  it('tracks daily new and review counts separately', async () => {
    repo.ensureCards(['a', 'b'], now);
    const entry = (cardId: string) => ({
      cardId, at: now.toISOString(), rating: Rating.Good, correct: true, domain: 'D1', elapsedMs: 500,
    });

    await repo.recordReview(review(repo.getCard('a')!, Rating.Good, DEFAULT_SETTINGS, now).progress, entry('a'), true);
    await repo.recordReview(review(repo.getCard('b')!, Rating.Good, DEFAULT_SETTINGS, now).progress, entry('b'), false);

    expect(repo.getDaily().new).toBe(1);
    expect(repo.getDaily().review).toBe(1);
    expect(repo.getDaily().date).toBe(todayKey());
  });

  it('persists across a reload', async () => {
    repo.ensureCards(['a'], now);
    const advanced = review(repo.getCard('a')!, Rating.Good, DEFAULT_SETTINGS, now).progress;
    await repo.recordReview(advanced, {
      cardId: 'a', at: now.toISOString(), rating: Rating.Good, correct: true, domain: 'D1', elapsedMs: 800,
    }, true);

    const reloaded = new ProgressRepository();
    await reloaded.load();
    expect(reloaded.getCard('a')?.reps).toBe(1);
    expect(reloaded.getLog()).toHaveLength(1);
  });

  it('persists settings changes', async () => {
    await repo.updateSettings({ examDate: '2026-11-01', maxNewPerDay: 35 });

    const reloaded = new ProgressRepository();
    await reloaded.load();
    expect(reloaded.getSettings().examDate).toBe('2026-11-01');
    expect(reloaded.getSettings().maxNewPerDay).toBe(35);
    // Untouched settings keep their defaults.
    expect(reloaded.getSettings().desiredRetention).toBe(DEFAULT_SETTINGS.desiredRetention);
  });

  it('resets the daily counter when the date rolls over', async () => {
    const store = new MemoryStore();
    __setStore(store);
    await store.set('daily', { date: '2020-01-01', new: 15, review: 40 });

    const fresh = new ProgressRepository();
    await fresh.load();
    expect(fresh.getDaily().new).toBe(0);
    expect(fresh.getDaily().date).toBe(todayKey());
  });

  it('suspends and unsuspends a card', async () => {
    repo.ensureCards(['a'], now);
    await repo.setSuspended('a', true);
    expect(repo.getCard('a')!.suspended).toBe(true);
    await repo.setSuspended('a', false);
    expect(repo.getCard('a')!.suspended).toBe(false);
  });

  it('clears everything on reset', async () => {
    repo.ensureCards(['a', 'b'], now);
    await repo.persist();
    await repo.resetAll();
    expect(repo.getProgress().size).toBe(0);
    expect(repo.getLog()).toHaveLength(0);
  });

  it('surfaces write failures rather than silently dropping data', async () => {
    __setStore(new BrokenStore());
    const broken = new ProgressRepository();
    await broken.load();
    broken.ensureCards(['a'], now);
    await expect(broken.persist()).rejects.toThrow();
  });
});

describe('backup', () => {
  let repo: ProgressRepository;

  beforeEach(async () => {
    __setStore(new MemoryStore());
    repo = new ProgressRepository();
    await repo.load();
    repo.ensureCards(['a', 'b'], now);
    await repo.updateSettings({ examDate: '2026-12-01' });
    await repo.persist();
  });

  it('round-trips through export and import', async () => {
    const json = serializeBackup(repo);
    const parsed = parseBackup(json);

    expect(parsed.format).toBe('nce-study-backup');
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(Object.keys(parsed.progress)).toHaveLength(2);
    expect(parsed.settings.examDate).toBe('2026-12-01');

    __setStore(new MemoryStore());
    const target = new ProgressRepository();
    await target.load();
    await target.replaceAll(parsed);

    expect(target.getProgress().size).toBe(2);
    expect(target.getSettings().examDate).toBe('2026-12-01');
  });

  it('carries practice-test history through export and import', async () => {
    await repo.recordExamResult({
      id: 'e1', at: '2026-07-26T00:00:00.000Z', total: 10, correct: 7,
      unanswered: 1, durationMs: 900_000, byDomain: { D1: { correct: 3, total: 4 } },
    });

    const parsed = parseBackup(serializeBackup(repo));
    expect(parsed.exams).toHaveLength(1);
    expect(parsed.exams[0]!.correct).toBe(7);

    __setStore(new MemoryStore());
    const target = new ProgressRepository();
    await target.load();
    await target.replaceAll(parsed);
    expect(target.getExamResults()).toHaveLength(1);
  });

  it('carries typed answer notes through export and import', async () => {
    await repo.setNote('a', 'what I wrote last time');

    const parsed = parseBackup(serializeBackup(repo));
    expect(parsed.notes).toEqual({ a: 'what I wrote last time' });

    __setStore(new MemoryStore());
    const target = new ProgressRepository();
    await target.load();
    await target.replaceAll(parsed);
    expect(target.getNote('a')).toBe('what I wrote last time');
  });

  it('tolerates a backup written before practice-test history existed', () => {
    const old = JSON.stringify({
      format: 'nce-study-backup', version: 1, progress: {},
    });
    expect(parseBackup(old).exams).toEqual([]);
    expect(parseBackup(old).notes).toEqual({});
  });

  it('rejects malformed JSON', () => {
    expect(() => parseBackup('{not json')).toThrow(BackupParseError);
  });

  it('rejects a file that is not a study backup', () => {
    expect(() => parseBackup(JSON.stringify({ format: 'something-else' }))).toThrow(BackupParseError);
  });

  it('rejects a backup from a newer app version', () => {
    const future = JSON.stringify({
      format: 'nce-study-backup',
      version: BACKUP_VERSION + 1,
      progress: {},
    });
    expect(() => parseBackup(future)).toThrow(/newer than this app supports/);
  });

  it('rejects a backup with no progress data', () => {
    const bad = JSON.stringify({ format: 'nce-study-backup', version: 1 });
    expect(() => parseBackup(bad)).toThrow(/missing progress/);
  });

  it('tolerates a backup with no review log', () => {
    const minimal = JSON.stringify({
      format: 'nce-study-backup',
      version: 1,
      progress: { a: newProgress('a', now) },
    });
    expect(parseBackup(minimal).log).toEqual([]);
  });
});
