import { describe, it, expect } from 'vitest';
import { hashForView, viewFromHash, DEFAULT_VIEW } from '../src/router';
import type { ViewName } from '../src/app';

const VIEWS: ViewName[] = ['home', 'study', 'dashboard', 'exam', 'browse', 'settings'];

describe('router', () => {
  it('gives every view its own hash', () => {
    const hashes = VIEWS.map(hashForView);
    expect(new Set(hashes).size).toBe(VIEWS.length);
  });

  it('round-trips every view through its hash', () => {
    for (const view of VIEWS) {
      expect(viewFromHash(hashForView(view))).toBe(view);
    }
  });

  it('uses the names from the navigation, not the internal view ids', () => {
    // The URL is part of the interface: #/progress reads better in a bookmark
    // than #/dashboard, which is a word this app deliberately never shows.
    expect(hashForView('dashboard')).toBe('#/progress');
    expect(hashForView('exam')).toBe('#/practice-test');
    expect(hashForView('browse')).toBe('#/cards');
    expect(hashForView('home')).toBe('#/start');
  });

  it('accepts hand-typed variations of a hash', () => {
    for (const hash of ['#/study', '#study', 'study', '/study', '#/study/', '#/STUDY']) {
      expect(viewFromHash(hash)).toBe('study');
    }
  });

  it('returns null for a hash that names nothing, so the caller can default', () => {
    expect(viewFromHash('')).toBeNull();
    expect(viewFromHash('#')).toBeNull();
    expect(viewFromHash('#/nonsense')).toBeNull();
    // Not routable: an internal id that is not also a slug must not resolve.
    expect(viewFromHash('#/dashboard')).toBeNull();
  });

  it('defaults to the home screen', () => {
    expect(DEFAULT_VIEW).toBe('home');
    expect(viewFromHash(hashForView(DEFAULT_VIEW))).toBe('home');
  });
});
