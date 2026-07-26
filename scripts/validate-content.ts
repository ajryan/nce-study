/**
 * Validates all deck content against the schema and the blueprint.
 * Exits non-zero on any issue, so it can gate CI.
 *
 *   npm run validate
 */
import { validateDeck, type ValidationContext } from '../src/data/schema';
import { loadBlueprint, loadReferences, loadDecks, allCards } from './lib/content';

const blueprint = loadBlueprint();
const references = loadReferences();
const decks = loadDecks();
const cards = allCards(decks);

const ctx: ValidationContext = {
  blueprint,
  referenceIds: new Set(references.map((r) => r.id)),
  optionsPerItem: blueprint.exam.optionsPerItem,
};

console.log(
  `Validating ${cards.length} cards across ${decks.length} deck file(s) ` +
    `against ${blueprint.exam.label}\n`,
);

if (decks.length === 0) {
  console.log('No deck files found in content/decks — nothing to validate yet.');
  process.exit(0);
}

// A deck file whose cards belong to a different domain is a filing error that
// would silently skew the blueprint weighting, so check it here.
const misfiled: string[] = [];
for (const deck of decks) {
  for (const card of deck.cards) {
    if (card.domain !== deck.domain) {
      misfiled.push(`  ${deck.file}: card ${card.id} has domain ${card.domain}, expected ${deck.domain}`);
    }
  }
}

const issues = validateDeck(cards, ctx);

for (const deck of decks) {
  console.log(`  ${deck.file.padEnd(42)} ${String(deck.cards.length).padStart(4)} cards`);
}

if (misfiled.length > 0) {
  console.log('\nMisfiled cards:');
  misfiled.forEach((m) => console.log(m));
}

if (issues.length > 0) {
  console.log(`\n${issues.length} validation issue(s):\n`);
  const byCard = new Map<string, string[]>();
  for (const issue of issues) {
    const list = byCard.get(issue.cardId) ?? [];
    list.push(issue.message);
    byCard.set(issue.cardId, list);
  }
  for (const [cardId, messages] of byCard) {
    console.log(`  ${cardId}`);
    messages.forEach((m) => console.log(`      - ${m}`));
  }
}

const total = issues.length + misfiled.length;
if (total > 0) {
  console.log(`\nFAILED — ${total} problem(s).`);
  process.exit(1);
}

console.log('\nAll content valid.');
