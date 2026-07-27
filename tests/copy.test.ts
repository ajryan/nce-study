/**
 * Voice guard for every user-facing string in the app.
 *
 * There is already a jargon guard on the Settings screen, and it exists because
 * a comment saying "keep this plain" does not survive the next edit. This is the
 * same idea applied to a different failure: copy that reads as machine-written.
 *
 * The patterns below are the ones readers react to most strongly — the negation
 * pivot ("X, not Y"), bolted-on em dashes, claims the app cannot support, and
 * reassurance the user did not ask for. They are cheap to reintroduce by
 * accident and impossible to unsee once noticed, which is exactly the profile
 * of a thing worth failing the build over.
 *
 * This scans source rather than rendered output on purpose: much of the copy
 * lives in states a test never renders (empty decks, storage failures, exam
 * shortfalls), and those deserve the same voice as the happy path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/main.ts',
  'src/ui/HomeView.ts',
  'src/ui/ReviewView.ts',
  'src/ui/DashboardView.ts',
  'src/ui/BrowseView.ts',
  'src/ui/ExamView.ts',
  'src/ui/SettingsView.ts',
];

interface Str {
  file: string;
  line: number;
  text: string;
}

/**
 * Pulls the prose out of a source file: string literals that read like a
 * sentence, rather than class lists, style rules, import paths or css values.
 */
function proseStrings(file: string): Str[] {
  const out: Str[] = [];
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Comments explain the code to us, not the app to the user.
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

    const pattern = /'([^'\\]+)'|"([^"\\]+)"|`([^`\\]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) {
      // Template expressions are values, not voice.
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '');
      if (!raw.includes(' ')) continue; // paths, ids, single class names
      if (/var\(|^[a-z-]+\s*:/.test(raw)) continue; // inline styles
      if (raw.includes('http')) continue;
      // Prose has a capital or punctuation; 'row small muted' has neither.
      if (!/[A-Z]/.test(raw) && !/[.,!?:;’']/.test(raw)) continue;
      out.push({ file, line: i + 1, text: raw });
    }
  });
  return out;
}

const ALL: Str[] = FILES.flatMap(proseStrings);

/** Reports every offender at once, the way the deck validator does. */
function offenders(rule: RegExp): string[] {
  return ALL.filter((s) => rule.test(s.text)).map((s) => `${s.file}:${s.line}  "${s.text.trim()}"`);
}

describe('user-facing copy', () => {
  it('finds strings to check at all', () => {
    // Guards the extractor: a regex change that quietly matches nothing would
    // make every test below pass for the wrong reason.
    expect(ALL.length).toBeGreaterThan(60);
  });

  it('never uses the negation pivot', () => {
    // "It's not X, it's Y" is the single most-recognised tell. It manufactures
    // insight by defining a thing against something nobody proposed — and here
    // it planted the very anxiety it claimed to soothe ("not a verdict").
    for (const rule of [
      /,\s*not\s+(a|an|the|just)\b/i,
      /\bnot just\b/i,
      /\bisn[’']t just\b/i,
      /\bit[’']s not\b/i,
      /\bnot a (verdict|judgement|judgment|failure|test of you)\b/i,
    ]) {
      expect(offenders(rule)).toEqual([]);
    }
  });

  it('never bolts a clause on with an em dash', () => {
    // The dash-as-afterthought is the punctuation tic people read as machine
    // cadence. A full stop or a colon says the same thing without the tell.
    expect(offenders(/—/)).toEqual([]);
  });

  it('never claims to know what the user knows', () => {
    // Ten cards cannot support "you clearly know this material", and saying so
    // to someone whose whole worry is whether they know it discredits every
    // other encouraging line in the app.
    expect(offenders(/you (clearly|obviously|definitely) (know|understand|have)/i)).toEqual([]);
    expect(offenders(/you[’']ve got this/i)).toEqual([]);
  });

  it('never congratulates itself on its own design', () => {
    expect(offenders(/\bthe system (is )?working\b/i)).toEqual([]);
    expect(offenders(/\bdoing real work\b/i)).toEqual([]);
  });

  it('never instructs the user how to feel', () => {
    expect(offenders(/\band remember,/i)).toEqual([]);
    expect(offenders(/\bno wrong (answer|pace|way)\b/i)).toEqual([]);
    expect(offenders(/\b(don[’']t worry|no need to worry|rest assured)\b/i)).toEqual([]);
  });

  it('never tacks on a pat of praise', () => {
    // "You've started every card at least once. Nice."
    expect(offenders(/[.!]\s*(Nice|Great|Perfect|Awesome|Well done)[.!]/)).toEqual([]);
  });

  it('keeps the Settings screen free of implementation vocabulary', () => {
    // The original guard, widened from one rendered screen to the whole file.
    const jargon = /\b(FSRS|IndexedDB|localStorage|serializ|interleav)/i;
    expect(offenders(jargon).filter((o) => o.startsWith('src/ui/SettingsView'))).toEqual([]);
  });
});
