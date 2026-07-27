/**
 * Hash-based routing for the six sections.
 *
 * Hashes rather than real paths, deliberately. GitHub Pages serves a static
 * site with no rewrite rules, so `/nce-study/progress` would 404 on a refresh —
 * the exact thing this is meant to fix. The single-file build is opened from
 * `file://`, where the History API is unusable and hashes still work.
 *
 * Slugs are the human-readable names from the navigation, not the internal
 * view ids: the URL is part of the interface, and `#/progress` is a nicer thing
 * to see in the address bar or a bookmark than `#/dashboard`.
 */
import type { ViewName } from './app';

const ROUTES: ReadonlyArray<{ view: ViewName; slug: string }> = [
  { view: 'home', slug: 'start' },
  { view: 'study', slug: 'study' },
  { view: 'dashboard', slug: 'progress' },
  { view: 'exam', slug: 'practice-test' },
  { view: 'browse', slug: 'cards' },
  { view: 'settings', slug: 'settings' },
];

export const DEFAULT_VIEW: ViewName = 'home';

/** The hash to put in the address bar for a view, including the leading `#`. */
export function hashForView(view: ViewName): string {
  const route = ROUTES.find((r) => r.view === view);
  return `#/${route ? route.slug : 'start'}`;
}

/**
 * Resolves a location hash to a view, or null if it names nothing we have.
 *
 * Lenient about the exact shape — `#/study`, `#study`, `study` and a trailing
 * slash all resolve — because a hand-typed or hand-edited URL should land
 * somewhere sensible rather than silently bouncing to Start.
 */
export function viewFromHash(hash: string): ViewName | null {
  const slug = hash.replace(/^#/, '').replace(/^\//, '').replace(/\/$/, '').toLowerCase();
  if (!slug) return null;
  return ROUTES.find((r) => r.slug === slug)?.view ?? null;
}
