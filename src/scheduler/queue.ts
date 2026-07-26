/**
 * Builds the daily study queue.
 *
 * Two ideas do the work here:
 *
 *   Interleaving — the evidence on exam preparation favours mixing topics over
 *   studying them in blocks, so due cards are shuffled across domains rather
 *   than grouped. Blocked practice feels more fluent and produces worse recall.
 *
 *   Blueprint weighting — new cards are introduced in proportion to how heavily
 *   each domain is tested, and the domain that is furthest behind its target
 *   share goes first. Over a study plan this pulls the deck toward the exam's
 *   own distribution instead of the order cards happen to sit in the files.
 */
import type { Card, DomainId } from '../data/schema';
import { isDue, isNew, type CardProgress, type SchedulerSettings } from './fsrs';

export interface QueueItem {
  card: Card;
  progress: CardProgress;
  kind: 'new' | 'due';
}

export interface DomainWeight {
  id: DomainId;
  weight: number;
}

export interface BuildQueueInput {
  cards: Card[];
  progress: Map<string, CardProgress>;
  settings: SchedulerSettings;
  domainWeights: DomainWeight[];
  now?: Date;
  /** Counts already studied today, so limits survive a page reload. */
  studiedToday?: { new: number; review: number };
  /** Injectable for deterministic tests. */
  random?: () => number;
}

/** Fisher-Yates, with an injectable RNG so tests are deterministic. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Spread items so the same domain rarely appears twice in a row.
 *
 * Greedy: repeatedly take from the domain with the most cards remaining,
 * skipping the domain used last where possible. This produces a genuinely
 * mixed sequence, unlike a plain shuffle which happily emits runs.
 */
export function interleaveByDomain(items: QueueItem[]): QueueItem[] {
  const buckets = new Map<DomainId, QueueItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.card.domain) ?? [];
    bucket.push(item);
    buckets.set(item.card.domain, bucket);
  }

  const out: QueueItem[] = [];
  let lastDomain: DomainId | null = null;

  while (out.length < items.length) {
    const candidates = [...buckets.entries()].filter(([, list]) => list.length > 0);
    if (candidates.length === 0) break;

    // Prefer the largest bucket that isn't the one we just used.
    const sorted = candidates.sort((a, b) => b[1].length - a[1].length);
    const pick = sorted.find(([domain]) => domain !== lastDomain) ?? sorted[0]!;

    const [domain, list] = pick;
    out.push(list.shift()!);
    lastDomain = domain;
  }

  return out;
}

/**
 * Order domains by how far each is below its blueprint share of already-seen
 * cards. The most under-represented domain introduces new cards first.
 */
export function domainIntroOrder(
  domainWeights: DomainWeight[],
  seenByDomain: Map<DomainId, number>,
  totalSeen: number,
): DomainId[] {
  return [...domainWeights]
    .map((dw) => {
      const seen = seenByDomain.get(dw.id) ?? 0;
      const actualShare = totalSeen > 0 ? (seen / totalSeen) * 100 : 0;
      return { id: dw.id, deficit: dw.weight - actualShare };
    })
    .sort((a, b) => b.deficit - a.deficit)
    .map((d) => d.id);
}

export function buildQueue(input: BuildQueueInput): QueueItem[] {
  const {
    cards,
    progress,
    settings,
    domainWeights,
    now = new Date(),
    studiedToday = { new: 0, review: 0 },
    random = Math.random,
  } = input;

  const byId = new Map(cards.map((c) => [c.id, c]));

  const dueItems: QueueItem[] = [];
  const newByDomain = new Map<DomainId, QueueItem[]>();
  const seenByDomain = new Map<DomainId, number>();
  let totalSeen = 0;

  for (const [cardId, p] of progress) {
    const card = byId.get(cardId);
    if (!card || p.suspended) continue;

    if (isNew(p)) {
      const list = newByDomain.get(card.domain) ?? [];
      list.push({ card, progress: p, kind: 'new' });
      newByDomain.set(card.domain, list);
    } else {
      seenByDomain.set(card.domain, (seenByDomain.get(card.domain) ?? 0) + 1);
      totalSeen++;
      if (isDue(p, now)) dueItems.push({ card, progress: p, kind: 'due' });
    }
  }

  // --- reviews -------------------------------------------------------------
  const reviewBudget = Math.max(0, settings.maxReviewsPerDay - studiedToday.review);
  let reviews = shuffle(dueItems, random);
  // Most-overdue first, so a backlog drains in a sensible order, then interleave.
  reviews.sort((a, b) => new Date(a.progress.due).getTime() - new Date(b.progress.due).getTime());
  reviews = reviews.slice(0, reviewBudget);
  if (settings.interleave) reviews = interleaveByDomain(reviews);

  // --- new cards -----------------------------------------------------------
  const newBudget = Math.max(0, settings.maxNewPerDay - studiedToday.new);
  const introOrder = domainIntroOrder(domainWeights, seenByDomain, totalSeen);
  const picked: QueueItem[] = [];

  // Round-robin across domains in deficit order until the budget is spent.
  const pools = new Map<DomainId, QueueItem[]>();
  for (const [domain, list] of newByDomain) pools.set(domain, shuffle(list, random));

  while (picked.length < newBudget) {
    let tookAny = false;
    for (const domain of introOrder) {
      if (picked.length >= newBudget) break;
      const pool = pools.get(domain);
      if (pool && pool.length > 0) {
        picked.push(pool.shift()!);
        tookAny = true;
      }
    }
    if (!tookAny) break;
  }

  const newItems = settings.interleave ? interleaveByDomain(picked) : picked;

  // Reviews lead: clearing what is already due matters more than new material,
  // and it front-loads the session with retrieval rather than reading.
  return [...reviews, ...newItems];
}

export interface QueueStats {
  due: number;
  new: number;
  learning: number;
  total: number;
}

export function queueStats(items: QueueItem[]): QueueStats {
  const due = items.filter((i) => i.kind === 'due').length;
  const fresh = items.filter((i) => i.kind === 'new').length;
  const learning = items.filter((i) => i.progress.state === 1 || i.progress.state === 3).length;
  return { due, new: fresh, learning, total: items.length };
}
