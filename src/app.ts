/**
 * Application state container.
 *
 * Holds the loaded deck, the progress repository, and the current session
 * queue. Views read from it and call back into it; there is no reactive
 * framework, so mutating methods re-render explicitly via `onChange`.
 */
import { bundledCards, blueprint, mergeCards } from './data/loader';
import type { Card } from './data/schema';
import { ProgressRepository, type ReviewLogEntry } from './storage/progress';
import { isDurable } from './storage/db';
import {
  review as scheduleReview,
  deriveRating,
  Rating,
  State,
  type CardProgress,
  type SchedulerSettings,
} from './scheduler/fsrs';
import { buildQueue, type QueueItem } from './scheduler/queue';
import type { Grade } from 'ts-fsrs';

export type ViewName = 'home' | 'study' | 'dashboard' | 'browse' | 'exam' | 'settings';

/**
 * How many cards to answer before the app pauses and offers a next step.
 * The point is to break a long queue into chunks that feel finishable, rather
 * than presenting an unbounded stream to someone already anxious.
 */
export const CHECKPOINT_EVERY = 10;

export class AppState {
  cards: Card[] = [];
  repo = new ProgressRepository();
  queue: QueueItem[] = [];
  queueIndex = 0;
  view: ViewName = 'home';
  onChange: () => void = () => {};

  /** Cards answered since this page load — drives the checkpoint pacing. */
  sessionAnswered = 0;
  sessionCorrect = 0;
  /** The `sessionAnswered` value at which the user last dismissed a checkpoint. */
  checkpointAcknowledgedAt = 0;

  get settings(): SchedulerSettings {
    return this.repo.getSettings();
  }

  get storageWarning(): string | null {
    if (isDurable(this.repo.tier)) return null;
    return (
      'Your browser is blocking persistent storage for this page, so progress will be ' +
      'lost when you close the tab. This usually means the file was opened directly ' +
      'from disk. Export your progress before leaving, or run the hosted version.'
    );
  }

  async init(): Promise<void> {
    this.cards = bundledCards;
    await this.repo.load();
    this.repo.ensureCards(this.cards.map((c) => c.id));
    await this.repo.persist();
    this.rebuildQueue();
  }

  /** Merge a user-supplied deck file over the bundled cards. */
  async importCards(extra: Card[]): Promise<void> {
    this.cards = mergeCards(this.cards, extra);
    this.repo.ensureCards(this.cards.map((c) => c.id));
    await this.repo.persist();
    this.rebuildQueue();
  }

  rebuildQueue(now: Date = new Date()): void {
    this.queue = buildQueue({
      cards: this.cards,
      progress: this.repo.getProgress(),
      settings: this.settings,
      domainWeights: blueprint.domains.map((d) => ({ id: d.id, weight: d.weight })),
      now,
      studiedToday: { ...this.repo.getDaily() },
    });
    this.queueIndex = 0;
  }

  get current(): QueueItem | null {
    return this.queue[this.queueIndex] ?? null;
  }

  get remaining(): number {
    return Math.max(0, this.queue.length - this.queueIndex);
  }

  /**
   * True when the user has just finished a chunk and should be offered a choice
   * about continuing. Suppressed once acknowledged, and never shown when the
   * queue is finished — that case gets the fuller completion screen instead.
   */
  get atCheckpoint(): boolean {
    return (
      this.sessionAnswered > 0 &&
      this.sessionAnswered % CHECKPOINT_EVERY === 0 &&
      this.checkpointAcknowledgedAt !== this.sessionAnswered &&
      this.remaining > 0
    );
  }

  acknowledgeCheckpoint(): void {
    this.checkpointAcknowledgedAt = this.sessionAnswered;
    this.onChange();
  }

  cardById(id: string): Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  /**
   * Grade the current card and advance.
   *
   * `correct` comes from the MCQ outcome where there is one; recall/cloze cards
   * pass undefined and the self-rating alone decides.
   */
  async answerCurrent(
    grade: Grade,
    correct: boolean | undefined,
    elapsedMs: number,
    now: Date = new Date(),
  ): Promise<void> {
    const item = this.current;
    if (!item) return;

    const wasNew = item.progress.state === State.New;
    const rating = correct === undefined ? grade : deriveRating(correct, grade);
    const { progress } = scheduleReview(item.progress, rating, this.settings, now, correct);

    const entry: ReviewLogEntry = {
      cardId: item.card.id,
      at: now.toISOString(),
      rating,
      correct: correct ?? rating !== Rating.Again,
      domain: item.card.domain,
      elapsedMs,
    };

    await this.repo.recordReview(progress, entry, wasNew);

    this.sessionAnswered++;
    if (entry.correct) this.sessionCorrect++;

    // A lapsed card is re-queued at the end of the session rather than being
    // left until tomorrow — short-term reconsolidation is the whole point of
    // the learning steps.
    if (rating === Rating.Again) {
      this.queue.push({ card: item.card, progress, kind: item.kind });
    }

    this.queueIndex++;
    this.onChange();
  }

  async suspendCurrent(): Promise<void> {
    const item = this.current;
    if (!item) return;
    await this.repo.setSuspended(item.card.id, true);
    this.queueIndex++;
    this.onChange();
  }

  // ---- derived stats -------------------------------------------------------

  progressFor(cardId: string): CardProgress | undefined {
    return this.repo.getCard(cardId);
  }

  countsByState(): { new: number; learning: number; review: number; suspended: number } {
    const out = { new: 0, learning: 0, review: 0, suspended: 0 };
    for (const p of this.repo.getProgress().values()) {
      if (p.suspended) out.suspended++;
      else if (p.state === State.New) out.new++;
      else if (p.state === State.Review) out.review++;
      else out.learning++;
    }
    return out;
  }

  /**
   * Cards considered "strong": in review state with stability comfortably past
   * the exam horizon. Used for the readiness estimate.
   */
  strongCount(horizonDays: number): number {
    let n = 0;
    for (const p of this.repo.getProgress().values()) {
      if (p.suspended) continue;
      if (p.state === State.Review && p.stability >= horizonDays) n++;
    }
    return n;
  }

  accuracy(): { correct: number; total: number } {
    let correct = 0;
    let total = 0;
    for (const p of this.repo.getProgress().values()) {
      correct += p.correctCount;
      total += p.answerCount;
    }
    return { correct, total };
  }

  /** Rolling accuracy over the most recent `n` logged answers. */
  recentAccuracy(n = 100): { correct: number; total: number } {
    const log = this.repo.getLog().slice(-n);
    return { correct: log.filter((e) => e.correct).length, total: log.length };
  }

  dueForecast(days = 14, now: Date = new Date()): number[] {
    const out = new Array<number>(days).fill(0);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const p of this.repo.getProgress().values()) {
      if (p.suspended || p.state === State.New) continue;
      const offset = Math.floor((new Date(p.due).getTime() - startOfToday) / 86_400_000);
      if (offset >= 0 && offset < days) out[offset]!++;
      else if (offset < 0) out[0]!++; // overdue lands on today
    }
    return out;
  }
}
