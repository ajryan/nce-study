/**
 * Node-side content loading, shared by the validate and coverage scripts.
 * The browser loader (src/data/loader.ts) uses Vite globs, which don't exist
 * under plain tsx, so scripts read the same files from disk instead.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Blueprint, Card, Reference } from '../../src/data/schema';

const root = new URL('../../', import.meta.url).pathname;
const contentDir = join(root, 'content');
const decksDir = join(contentDir, 'decks');

export function loadBlueprint(): Blueprint {
  return JSON.parse(readFileSync(join(contentDir, 'blueprint.json'), 'utf8')) as Blueprint;
}

export function loadReferences(): Reference[] {
  const parsed = JSON.parse(readFileSync(join(contentDir, 'references.json'), 'utf8')) as {
    references: Reference[];
  };
  return parsed.references;
}

export interface LoadedDeck {
  file: string;
  domain: string;
  cards: Card[];
}

export function loadDecks(): LoadedDeck[] {
  if (!existsSync(decksDir)) return [];
  return readdirSync(decksDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const parsed = JSON.parse(readFileSync(join(decksDir, file), 'utf8')) as {
        domain: string;
        cards: Card[];
      };
      return { file, domain: parsed.domain, cards: parsed.cards ?? [] };
    });
}

export function allCards(decks: LoadedDeck[]): Card[] {
  return decks.flatMap((d) => d.cards);
}
