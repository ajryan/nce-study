/**
 * Loads bundled deck content at build time and merges any user-imported decks.
 *
 * Deck JSON is bundled rather than fetched so that the single-file build has no
 * network dependency at all.
 */
import blueprintJson from '../../content/blueprint.json';
import referencesJson from '../../content/references.json';
import type { Blueprint, Card, Reference } from './schema';

export const blueprint = blueprintJson as unknown as Blueprint;

export const references: Reference[] = (referencesJson as { references: Reference[] }).references;

const referenceById = new Map(references.map((r) => [r.id, r]));

export function getReference(id: string): Reference | undefined {
  return referenceById.get(id);
}

export function resolveRefs(ids: string[]): Reference[] {
  return ids.map((id) => referenceById.get(id)).filter((r): r is Reference => r !== undefined);
}

// Eager glob so deck data lands in the bundle instead of being fetched.
const deckModules = import.meta.glob<{ default: { domain: string; cards: Card[] } }>(
  '../../content/decks/*.json',
  { eager: true },
);

function loadBundledCards(): Card[] {
  const cards: Card[] = [];
  for (const key of Object.keys(deckModules).sort()) {
    const mod = deckModules[key];
    if (mod?.default?.cards) cards.push(...mod.default.cards);
  }
  return cards;
}

export const bundledCards: Card[] = loadBundledCards();

/**
 * Merge user-imported cards over the bundled deck. A user card with the same id
 * as a bundled card wins, which is what makes local corrections possible without
 * forking the repo.
 */
export function mergeCards(base: Card[], imported: Card[]): Card[] {
  const byId = new Map(base.map((c) => [c.id, c]));
  for (const card of imported) byId.set(card.id, card);
  return [...byId.values()];
}

export function domainById(id: string) {
  return blueprint.domains.find((d) => d.id === id);
}

export function taskLabel(card: Card): string {
  const domain = domainById(card.domain);
  if (!domain) return card.task;
  const letter = card.task.replace(/^\d+/, '');
  return domain.tasks[letter] ?? card.task;
}
