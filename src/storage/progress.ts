/**
 * Study state repository: card progress, settings, daily counts, review log.
 *
 * With a deck in the hundreds of cards, the whole progress map fits comfortably
 * in one record, so state is stored as a few coarse blobs rather than one row
 * per card. That keeps writes atomic and the export format trivial.
 */
import { getStore, type StorageTier } from './db';
import { DEFAULT_SETTINGS, newProgress, type CardProgress, type SchedulerSettings } from '../scheduler/fsrs';

const KEY_PROGRESS = 'progress';
const KEY_SETTINGS = 'settings';
const KEY_DAILY = 'daily';
const KEY_LOG = 'reviewLog';
const KEY_EXAMS = 'examResults';

/** Keeps the log useful for stats without letting it grow without bound. */
const MAX_LOG_ENTRIES = 20_000;
/** Practice tests are rare and each record is small; this is plenty of history. */
const MAX_EXAM_RESULTS = 50;

export interface ReviewLogEntry {
  cardId: string;
  at: string;
  rating: number;
  correct: boolean;
  domain: string;
  /** Milliseconds spent on the card. */
  elapsedMs: number;
}

/**
 * A completed practice test. Stored rather than shown once and discarded,
 * because the trend across attempts is the part that actually tells you whether
 * you are getting exam-ready, and the per-topic split is measured under exam
 * conditions rather than inferred from spaced-repetition state.
 */
export interface ExamResult {
  id: string;
  at: string;
  /** Questions asked. May be less than a full-length paper. */
  total: number;
  correct: number;
  unanswered: number;
  durationMs: number;
  /** Per NBCC domain id: how many right out of how many asked. */
  byDomain: Record<string, { correct: number; total: number }>;
}

export interface DailyCounts {
  date: string;
  new: number;
  review: number;
}

export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export class ProgressRepository {
  private progress = new Map<string, CardProgress>();
  private settings: SchedulerSettings = { ...DEFAULT_SETTINGS };
  private daily: DailyCounts = { date: todayKey(), new: 0, review: 0 };
  private log: ReviewLogEntry[] = [];
  private exams: ExamResult[] = [];
  private loaded = false;
  tier: StorageTier = 'memory';

  async load(): Promise<void> {
    const store = await getStore();
    this.tier = store.tier;

    const [progress, settings, daily, log, exams] = await Promise.all([
      store.get<Record<string, CardProgress>>(KEY_PROGRESS),
      store.get<Partial<SchedulerSettings>>(KEY_SETTINGS),
      store.get<DailyCounts>(KEY_DAILY),
      store.get<ReviewLogEntry[]>(KEY_LOG),
      store.get<ExamResult[]>(KEY_EXAMS),
    ]);

    this.progress = new Map(Object.entries(progress ?? {}));
    this.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    this.log = log ?? [];
    this.exams = exams ?? [];

    const today = todayKey();
    this.daily = daily?.date === today ? daily : { date: today, new: 0, review: 0 };
    this.loaded = true;
  }

  /** Adds progress records for any cards that don't have one yet. */
  ensureCards(cardIds: string[], now: Date = new Date()): void {
    for (const id of cardIds) {
      if (!this.progress.has(id)) this.progress.set(id, newProgress(id, now));
    }
    // Drop orphans so a shrunk deck doesn't leave dead state behind.
    const valid = new Set(cardIds);
    for (const id of [...this.progress.keys()]) {
      if (!valid.has(id)) this.progress.delete(id);
    }
  }

  getProgress(): Map<string, CardProgress> {
    return this.progress;
  }

  getCard(cardId: string): CardProgress | undefined {
    return this.progress.get(cardId);
  }

  getSettings(): SchedulerSettings {
    return this.settings;
  }

  getDaily(): DailyCounts {
    const today = todayKey();
    if (this.daily.date !== today) this.daily = { date: today, new: 0, review: 0 };
    return this.daily;
  }

  getLog(): ReviewLogEntry[] {
    return this.log;
  }

  /** Oldest first, so a chart reads left to right without re-sorting. */
  getExamResults(): ExamResult[] {
    return this.exams;
  }

  async recordExamResult(result: ExamResult): Promise<void> {
    this.exams.push(result);
    if (this.exams.length > MAX_EXAM_RESULTS) {
      this.exams = this.exams.slice(-MAX_EXAM_RESULTS);
    }
    const store = await getStore();
    await store.set(KEY_EXAMS, this.exams);
  }

  async updateSettings(patch: Partial<SchedulerSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    const store = await getStore();
    await store.set(KEY_SETTINGS, this.settings);
  }

  async recordReview(
    progress: CardProgress,
    entry: ReviewLogEntry,
    wasNew: boolean,
  ): Promise<void> {
    this.progress.set(progress.cardId, progress);

    const daily = this.getDaily();
    if (wasNew) daily.new++;
    else daily.review++;

    this.log.push(entry);
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log = this.log.slice(-MAX_LOG_ENTRIES);
    }

    await this.persist();
  }

  async setSuspended(cardId: string, suspended: boolean): Promise<void> {
    const p = this.progress.get(cardId);
    if (!p) return;
    p.suspended = suspended;
    await this.persist();
  }

  async persist(): Promise<void> {
    const store = await getStore();
    await Promise.all([
      store.set(KEY_PROGRESS, Object.fromEntries(this.progress)),
      store.set(KEY_DAILY, this.daily),
      store.set(KEY_LOG, this.log),
      store.set(KEY_EXAMS, this.exams),
    ]);
  }

  async resetAll(): Promise<void> {
    const store = await getStore();
    await store.clear();
    this.progress.clear();
    this.log = [];
    this.exams = [];
    this.daily = { date: todayKey(), new: 0, review: 0 };
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /** Replaces all state — used by import. */
  async replaceAll(state: {
    progress: Record<string, CardProgress>;
    settings: SchedulerSettings;
    daily: DailyCounts;
    log: ReviewLogEntry[];
    exams?: ExamResult[];
  }): Promise<void> {
    this.progress = new Map(Object.entries(state.progress));
    this.settings = { ...DEFAULT_SETTINGS, ...state.settings };
    this.daily = state.daily;
    this.log = state.log;
    this.exams = state.exams ?? [];
    const store = await getStore();
    await store.set(KEY_SETTINGS, this.settings);
    await this.persist();
  }

  snapshot() {
    return {
      progress: Object.fromEntries(this.progress),
      settings: this.settings,
      daily: this.daily,
      log: this.log,
      exams: this.exams,
    };
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
