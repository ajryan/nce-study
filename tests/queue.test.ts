import { describe, it, expect } from 'vitest';
import { buildQueue, interleaveByDomain, domainIntroOrder, shuffle, queueStats, type QueueItem } from '../src/scheduler/queue';
import { newProgress, review, Rating, DEFAULT_SETTINGS, type CardProgress, type SchedulerSettings } from '../src/scheduler/fsrs';
import type { Card, DomainId } from '../src/data/schema';

const now = new Date('2026-07-25T12:00:00Z');

const DOMAIN_WEIGHTS = [
  { id: 'D1' as DomainId, weight: 12 },
  { id: 'D2' as DomainId, weight: 12 },
  { id: 'D3' as DomainId, weight: 29 },
  { id: 'D4' as DomainId, weight: 9 },
  { id: 'D5' as DomainId, weight: 30 },
  { id: 'D6' as DomainId, weight: 8 },
];

function card(id: string, domain: DomainId): Card {
  return {
    id,
    type: 'recall',
    domain,
    task: `${domain.slice(1)}A`,
    cacrep: ['professional-ethics'],
    tags: [],
    prompt: 'q',
    answer: 'a',
    explanation: 'e',
    refs: ['aca-ethics'],
  };
}

function makeCards(perDomain: number): Card[] {
  const out: Card[] = [];
  for (const { id } of DOMAIN_WEIGHTS) {
    for (let i = 0; i < perDomain; i++) out.push(card(`${id.toLowerCase()}-${i}`, id));
  }
  return out;
}

function freshProgress(cards: Card[]): Map<string, CardProgress> {
  return new Map(cards.map((c) => [c.id, newProgress(c.id, now)]));
}

const settings = (patch: Partial<SchedulerSettings> = {}): SchedulerSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

/** Deterministic RNG so shuffles are reproducible in assertions. */
function seededRandom(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('shuffle', () => {
  it('preserves every element', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input, seededRandom());
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4];
    shuffle(input, seededRandom());
    expect(input).toEqual([1, 2, 3, 4]);
  });
});

describe('interleaveByDomain', () => {
  function item(id: string, domain: DomainId): QueueItem {
    return { card: card(id, domain), progress: newProgress(id, now), kind: 'due' };
  }

  it('avoids consecutive cards from the same domain when it can', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => item(`a${i}`, 'D1')),
      ...Array.from({ length: 5 }, (_, i) => item(`b${i}`, 'D2')),
      ...Array.from({ length: 5 }, (_, i) => item(`c${i}`, 'D3')),
    ];
    const out = interleaveByDomain(items);

    expect(out).toHaveLength(15);
    let adjacent = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i]!.card.domain === out[i - 1]!.card.domain) adjacent++;
    }
    // With three equal buckets a perfect alternation exists.
    expect(adjacent).toBe(0);
  });

  it('keeps every item even when one domain dominates', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item(`a${i}`, 'D5')),
      item('b0', 'D1'),
    ];
    const out = interleaveByDomain(items);
    expect(out).toHaveLength(11);
    expect(new Set(out.map((i) => i.card.id)).size).toBe(11);
  });

  it('handles a single domain without looping forever', () => {
    const items = Array.from({ length: 4 }, (_, i) => item(`a${i}`, 'D3'));
    expect(interleaveByDomain(items)).toHaveLength(4);
  });

  it('handles an empty list', () => {
    expect(interleaveByDomain([])).toEqual([]);
  });
});

describe('domainIntroOrder', () => {
  it('puts the most under-represented domain first', () => {
    // D1 is hugely over-served (90% seen against a 12% target) so it goes last.
    // D3 leads: 0% seen against a 29% target is a bigger deficit than D5's
    // 10% seen against 30%.
    const seen = new Map<DomainId, number>([['D1', 90], ['D5', 10]]);
    const order = domainIntroOrder(DOMAIN_WEIGHTS, seen, 100);
    expect(order[0]).toBe('D3');
    expect(order[1]).toBe('D5');
    expect(order[order.length - 1]).toBe('D1');
  });

  it('falls back to raw weight order when nothing has been seen', () => {
    const order = domainIntroOrder(DOMAIN_WEIGHTS, new Map(), 0);
    expect(order[0]).toBe('D5'); // 30%, the heaviest domain
    expect(order[1]).toBe('D3'); // 29%
  });
});

describe('buildQueue', () => {
  it('respects the daily new-card limit', () => {
    const cards = makeCards(20);
    const queue = buildQueue({
      cards,
      progress: freshProgress(cards),
      settings: settings({ maxNewPerDay: 10 }),
      domainWeights: DOMAIN_WEIGHTS,
      now,
      random: seededRandom(),
    });
    expect(queue.filter((i) => i.kind === 'new')).toHaveLength(10);
  });

  it('subtracts cards already studied today from the budget', () => {
    const cards = makeCards(20);
    const queue = buildQueue({
      cards,
      progress: freshProgress(cards),
      settings: settings({ maxNewPerDay: 10 }),
      domainWeights: DOMAIN_WEIGHTS,
      now,
      studiedToday: { new: 7, review: 0 },
      random: seededRandom(),
    });
    expect(queue.filter((i) => i.kind === 'new')).toHaveLength(3);
  });

  it('introduces new cards across domains, weighted toward heavy ones', () => {
    const cards = makeCards(50);
    const queue = buildQueue({
      cards,
      progress: freshProgress(cards),
      settings: settings({ maxNewPerDay: 30 }),
      domainWeights: DOMAIN_WEIGHTS,
      now,
      random: seededRandom(),
    });
    const domains = new Set(queue.map((i) => i.card.domain));
    // Round-robin in deficit order should touch every domain within 30 cards.
    expect(domains.size).toBe(6);
  });

  it('excludes suspended cards', () => {
    const cards = makeCards(5);
    const progress = freshProgress(cards);
    for (const [, p] of progress) p.suspended = true;

    const queue = buildQueue({
      cards,
      progress,
      settings: settings(),
      domainWeights: DOMAIN_WEIGHTS,
      now,
      random: seededRandom(),
    });
    expect(queue).toHaveLength(0);
  });

  it('excludes cards that are scheduled into the future', () => {
    const cards = makeCards(3);
    const progress = freshProgress(cards);
    for (const [id, p] of progress) {
      progress.set(id, review(p, Rating.Easy, settings(), now).progress);
    }
    const queue = buildQueue({
      cards,
      progress,
      settings: settings(),
      domainWeights: DOMAIN_WEIGHTS,
      now,
      random: seededRandom(),
    });
    expect(queue).toHaveLength(0);
  });

  it('surfaces due cards once their time arrives, most overdue first', () => {
    const cards = makeCards(3);
    const progress = freshProgress(cards);
    for (const [id, p] of progress) {
      progress.set(id, review(p, Rating.Good, settings(), now).progress);
    }
    const muchLater = new Date(now.getTime() + 400 * 86_400_000);
    const queue = buildQueue({
      cards,
      progress,
      settings: settings({ interleave: false }),
      domainWeights: DOMAIN_WEIGHTS,
      now: muchLater,
      random: seededRandom(),
    });

    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((i) => i.kind === 'due')).toBe(true);
    for (let i = 1; i < queue.length; i++) {
      expect(new Date(queue[i]!.progress.due).getTime()).toBeGreaterThanOrEqual(
        new Date(queue[i - 1]!.progress.due).getTime(),
      );
    }
  });

  it('puts due reviews before new cards', () => {
    const cards = makeCards(10);
    const progress = freshProgress(cards);
    // Make three cards due by reviewing them then jumping forward.
    const ids = cards.slice(0, 3).map((c) => c.id);
    for (const id of ids) {
      progress.set(id, review(progress.get(id)!, Rating.Good, settings(), now).progress);
    }
    const later = new Date(now.getTime() + 400 * 86_400_000);

    const queue = buildQueue({
      cards,
      progress,
      settings: settings({ maxNewPerDay: 5 }),
      domainWeights: DOMAIN_WEIGHTS,
      now: later,
      random: seededRandom(),
    });

    const firstNew = queue.findIndex((i) => i.kind === 'new');
    const lastDue = queue.map((i) => i.kind).lastIndexOf('due');
    expect(firstNew).toBeGreaterThan(lastDue);
  });

  it('ignores progress entries whose card no longer exists', () => {
    const cards = makeCards(2);
    const progress = freshProgress(cards);
    progress.set('ghost-card', newProgress('ghost-card', now));

    const queue = buildQueue({
      cards,
      progress,
      settings: settings(),
      domainWeights: DOMAIN_WEIGHTS,
      now,
      random: seededRandom(),
    });
    expect(queue.every((i) => i.card.id !== 'ghost-card')).toBe(true);
  });
});

describe('queueStats', () => {
  it('counts each kind', () => {
    const cards = makeCards(4);
    const queue = buildQueue({
      cards,
      progress: freshProgress(cards),
      settings: settings({ maxNewPerDay: 6 }),
      domainWeights: DOMAIN_WEIGHTS,
      now,
      random: seededRandom(),
    });
    const stats = queueStats(queue);
    expect(stats.total).toBe(queue.length);
    expect(stats.new).toBe(6);
    expect(stats.due).toBe(0);
  });
});
