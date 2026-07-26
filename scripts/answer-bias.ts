/**
 * Detects give-away patterns in multiple-choice options.
 *
 * The failure this exists to catch: if the correct answer is reliably the
 * longest, most-qualified option, a test-taker can score highly by pattern-
 * matching instead of knowing the material — which makes the deck actively
 * misleading as preparation. It is an easy bias to introduce without noticing,
 * because a correct answer naturally attracts caveats ("...consistent with
 * state law and the code of ethics") while wrong ones stay blunt.
 *
 * Measured, not eyeballed. An early draft scored 94.1% here: someone who always
 * picked the longest option would have "known" 94% of the deck.
 *
 *   npm run bias
 */
import { loadDecks, allCards } from './lib/content';
import type { Card } from '../src/data/schema';

/**
 * Share of cards where the correct answer is *strictly* longer than every
 * distractor. Ties are excluded deliberately: if two options are the same
 * length, a length-guesser gains nothing from them, so counting a tie as a
 * "tell" overstates the problem. The expected score for someone who always
 * guesses longest is reported separately and is the number that actually
 * matters.
 */
const MAX_LONGEST_SHARE = 0.4;
/** Mean correct length ÷ mean distractor length. */
const MAX_LENGTH_RATIO = 1.15;
const MIN_LENGTH_RATIO = 0.85;
/** Per-card: how much longer the correct answer may be than the mean distractor. */
const MAX_CARD_RATIO = 2.0;

interface Stats {
  n: number;
  longest: number;
  ties: number;
  /** Expected score for someone who always picks the longest option. */
  guessScore: number;
  shortest: number;
  meanCorrect: number;
  meanDistractor: number;
  ratio: number;
  worst: Array<{ id: string; ratio: number; correctLen: number; distractorLen: number }>;
}

export function analyse(cards: Card[]): Stats {
  const mcq = cards.filter((c) => c.choices && c.choices.length > 0);
  let longest = 0;
  let shortest = 0;
  let sumCorrect = 0;
  let sumDistractor = 0;
  let nDistractor = 0;
  let ties = 0;
  let guessScore = 0;
  const worst: Stats['worst'] = [];

  for (const card of mcq) {
    const choices = card.choices!;
    const lens = choices.map((c) => c.text.trim().length);
    const ci = choices.findIndex((c) => c.correct);
    if (ci < 0) continue;

    const correctLen = lens[ci]!;
    const otherLens = lens.filter((_, i) => i !== ci);
    const maxOther = Math.max(...otherLens);

    if (correctLen > maxOther) {
      longest++;
      guessScore += 1;
    } else if (correctLen === maxOther) {
      ties++;
      // A guesser picking at random among the equal-longest options.
      const tiedCount = lens.filter((l) => l === correctLen).length;
      guessScore += 1 / tiedCount;
    }
    if (correctLen < Math.min(...otherLens)) shortest++;

    const distractors = lens.filter((_, i) => i !== ci);
    const meanD = distractors.reduce((a, b) => a + b, 0) / Math.max(distractors.length, 1);

    sumCorrect += correctLen;
    sumDistractor += distractors.reduce((a, b) => a + b, 0);
    nDistractor += distractors.length;

    const ratio = correctLen / Math.max(meanD, 1);
    if (ratio > MAX_CARD_RATIO) {
      worst.push({ id: card.id, ratio, correctLen, distractorLen: Math.round(meanD) });
    }
  }

  const meanCorrect = sumCorrect / Math.max(mcq.length, 1);
  const meanDistractor = sumDistractor / Math.max(nDistractor, 1);

  return {
    n: mcq.length,
    longest,
    ties,
    guessScore,
    shortest,
    meanCorrect,
    meanDistractor,
    ratio: meanCorrect / Math.max(meanDistractor, 1),
    worst: worst.sort((a, b) => b.ratio - a.ratio),
  };
}

const cards = allCards(loadDecks());
const s = analyse(cards);

if (s.n === 0) {
  console.log('No multiple-choice cards to analyse.');
  process.exit(0);
}

const longestShare = s.longest / s.n;
const shortestShare = s.shortest / s.n;
const chance = 1 / (cards.find((c) => c.choices)?.choices?.length ?? 4);

console.log(`Answer-length bias across ${s.n} multiple-choice cards\n`);
console.log(`  Correct is strictly the longest option  ${(longestShare * 100).toFixed(1)}%  (chance ${(chance * 100).toFixed(0)}%, limit ${MAX_LONGEST_SHARE * 100}%)`);
console.log(`  Tied for longest (no signal either way) ${((s.ties / s.n) * 100).toFixed(1)}%`);
console.log(`  Correct is strictly the shortest option ${(shortestShare * 100).toFixed(1)}%`);
console.log(`  Mean length — correct ${s.meanCorrect.toFixed(1)} chars, distractors ${s.meanDistractor.toFixed(1)} chars`);
console.log(`  Length ratio                           ${s.ratio.toFixed(3)}  (target ${MIN_LENGTH_RATIO}–${MAX_LENGTH_RATIO})`);
console.log(
  `\n  Always picking the longest option would score ${((s.guessScore / s.n) * 100).toFixed(1)}% ` +
    `(chance is ${(chance * 100).toFixed(0)}%).`,
);

const failures: string[] = [];
if (longestShare > MAX_LONGEST_SHARE) {
  failures.push(
    `correct answer is strictly the longest in ${(longestShare * 100).toFixed(1)}% of cards ` +
      `(limit ${MAX_LONGEST_SHARE * 100}%) — the deck can be gamed on shape alone`,
  );
}
if (s.ratio > MAX_LENGTH_RATIO || s.ratio < MIN_LENGTH_RATIO) {
  failures.push(
    `mean length ratio ${s.ratio.toFixed(3)} is outside ${MIN_LENGTH_RATIO}–${MAX_LENGTH_RATIO}`,
  );
}

if (s.worst.length > 0) {
  console.log(`\n  ${s.worst.length} card(s) where the correct answer is more than ${MAX_CARD_RATIO}x the mean distractor:`);
  for (const w of s.worst.slice(0, 25)) {
    console.log(`    ${w.ratio.toFixed(2)}x  ${w.id.padEnd(34)} correct ${w.correctLen} vs ${w.distractorLen} chars`);
  }
  if (s.worst.length > 25) console.log(`    …and ${s.worst.length - 25} more`);
}

if (failures.length > 0) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}

console.log('\nNo systematic length tell.');
