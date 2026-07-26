/**
 * Reports deck coverage on both axes that matter.
 *
 *   Axis 1 — NBCC domains. Card mix should track exam weighting, so study time
 *            is spent in proportion to what the exam actually tests.
 *   Axis 2 — CACREP core areas. The six domains are *work behaviours*, not
 *            subjects; foundational material (career theory, human development,
 *            group work, research/stats) hides inside D3 and D5 and would be
 *            silently under-covered if only axis 1 were checked.
 *
 * Exits non-zero when the deck is complete-ish but out of balance, so it can
 * gate a release without blocking work-in-progress.
 *
 *   npm run coverage
 */
import type { CacrepArea } from '../src/data/schema';
import { loadBlueprint, loadDecks, allCards } from './lib/content';

const WEIGHT_TOLERANCE_PCT = 2; // allowed drift from blueprint weight
const CACREP_FLOOR_PCT = 3; // no core area may fall below this share
const COMPLETENESS_THRESHOLD = 0.9; // only enforce once deck is ~built out

const blueprint = loadBlueprint();
const cards = allCards(loadDecks());

if (cards.length === 0) {
  console.log('No cards yet — nothing to report.');
  process.exit(0);
}

const targetTotal = blueprint.domains.reduce((sum, d) => sum + d.targetCards, 0);
const complete = cards.length / targetTotal >= COMPLETENESS_THRESHOLD;

console.log(`Deck coverage — ${cards.length} cards (target ${targetTotal})\n`);

// ---- Axis 1: NBCC domains -------------------------------------------------
console.log('Domain (NBCC blueprint)');
console.log('  id   name                                   cards  target   share  weight   drift');

const failures: string[] = [];

for (const domain of blueprint.domains) {
  const count = cards.filter((c) => c.domain === domain.id).length;
  const share = (count / cards.length) * 100;
  const drift = share - domain.weight;
  const flag = complete && Math.abs(drift) > WEIGHT_TOLERANCE_PCT ? ' <-- off' : '';
  console.log(
    `  ${domain.id}   ${domain.name.padEnd(38)} ${String(count).padStart(5)}` +
      `  ${String(domain.targetCards).padStart(6)}  ${share.toFixed(1).padStart(5)}%` +
      `  ${String(domain.weight).padStart(5)}%  ${drift >= 0 ? '+' : ''}${drift.toFixed(1)}%${flag}`,
  );
  if (complete && Math.abs(drift) > WEIGHT_TOLERANCE_PCT) {
    failures.push(
      `${domain.id} share ${share.toFixed(1)}% differs from blueprint weight ${domain.weight}% ` +
        `by more than ${WEIGHT_TOLERANCE_PCT}%`,
    );
  }
}

// ---- Axis 2: CACREP core areas -------------------------------------------
console.log('\nCACREP core area (second coverage axis)');
console.log('  area                                          cards   share');

for (const area of blueprint.cacrepAreas) {
  const count = cards.filter((c) => c.cacrep.includes(area.id as CacrepArea)).length;
  // Cards may carry multiple areas, so share is of cards-tagged, not a partition.
  const share = (count / cards.length) * 100;
  const low = complete && share < CACREP_FLOOR_PCT;
  console.log(
    `  ${area.name.padEnd(45)} ${String(count).padStart(5)}  ${share.toFixed(1).padStart(5)}%` +
      (low ? '  <-- under floor' : '') +
      (count === 0 ? '  <-- NOT COVERED' : ''),
  );
  if (count === 0) {
    failures.push(`CACREP area "${area.name}" has no cards at all`);
  } else if (low) {
    failures.push(`CACREP area "${area.name}" at ${share.toFixed(1)}% is below the ${CACREP_FLOOR_PCT}% floor`);
  }
}

// ---- Card type and task coverage -----------------------------------------
console.log('\nCard types');
for (const type of ['mcq', 'scenario', 'recall', 'cloze'] as const) {
  const count = cards.filter((c) => c.type === type).length;
  console.log(`  ${type.padEnd(10)} ${String(count).padStart(5)}  ${((count / cards.length) * 100).toFixed(1)}%`);
}

console.log('\nBlueprint task coverage (tasks with at least one card)');
for (const domain of blueprint.domains) {
  const taskLetters = Object.keys(domain.tasks);
  const covered = taskLetters.filter((letter) =>
    cards.some((c) => c.domain === domain.id && c.task === `${domain.number}${letter}`),
  );
  const pct = (covered.length / taskLetters.length) * 100;
  console.log(
    `  ${domain.id}  ${String(covered.length).padStart(3)}/${String(taskLetters.length).padEnd(3)} tasks  ${pct.toFixed(0).padStart(3)}%`,
  );
}

if (!complete) {
  console.log(
    `\nDeck is ${((cards.length / targetTotal) * 100).toFixed(0)}% built out — ` +
      `balance thresholds not enforced until ${COMPLETENESS_THRESHOLD * 100}%.`,
  );
  process.exit(0);
}

if (failures.length > 0) {
  console.log('\nCoverage failures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}

console.log('\nCoverage balanced on both axes.');
