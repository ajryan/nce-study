/**
 * Applies rewritten multiple-choice option text from a patch file.
 *
 * Only the `text` of each choice is replaced — `correct`, rationales,
 * explanations and references are left untouched. Keyed by card id, with the
 * new texts given in the card's existing choice order.
 *
 *   npx tsx scripts/apply-choice-texts.ts <patch.json>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const patchPath = process.argv[2];
if (!patchPath) throw new Error('usage: apply-choice-texts.ts <patch.json>');

const patch = JSON.parse(readFileSync(patchPath, 'utf8')) as Record<string, string[]>;
const dir = new URL('../content/decks/', import.meta.url).pathname;

let applied = 0;
const missing = new Set(Object.keys(patch));

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const full = join(dir, file);
  const deck = JSON.parse(readFileSync(full, 'utf8')) as {
    cards: Array<{ id: string; choices?: Array<{ text: string }> }>;
  };
  let touched = false;

  for (const card of deck.cards) {
    const next = patch[card.id];
    if (!next) continue;
    missing.delete(card.id);
    if (!card.choices) throw new Error(`${card.id} has no choices`);
    if (card.choices.length !== next.length) {
      throw new Error(`${card.id}: patch has ${next.length} texts, card has ${card.choices.length}`);
    }
    card.choices.forEach((c, i) => {
      c.text = next[i]!;
    });
    touched = true;
    applied++;
  }

  if (touched) writeFileSync(full, `${JSON.stringify(deck, null, 2)}\n`);
}

if (missing.size > 0) {
  console.error(`Unmatched card ids: ${[...missing].join(', ')}`);
  process.exit(1);
}
console.log(`Rewrote options on ${applied} cards.`);
