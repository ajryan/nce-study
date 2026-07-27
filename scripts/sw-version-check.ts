/**
 * Proves a real deploy actually triggers the update prompt.
 *
 * `check:update` exercises the flow *given* a changed worker — it edits
 * dist/sw.js by hand to simulate one. That passed happily while the prompt was
 * dead in production, because `public/sw.js` is copied to dist/ verbatim and so
 * was byte-identical on every deploy. The browser compares those bytes; finding
 * no difference, it never installed a new worker and never showed the banner.
 *
 * So this checks the trigger rather than the mechanism, in both directions:
 *
 *   1. changing app source changes dist/sw.js  (or no one is ever told)
 *   2. rebuilding unchanged source does not    (or everyone is told constantly)
 *
 * Run with: npx tsx scripts/sw-version-check.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SW = 'dist/sw.js';
const PROBE = 'src/ui/HomeView.ts';

const passed: string[] = [];
const failed: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  (ok ? passed : failed).push(detail ? `${name} — ${detail}` : name);
};

function build(): void {
  execFileSync('npx', ['vite', 'build'], { stdio: 'pipe' });
}

function version(): string {
  const m = /const VERSION = '([^']*)';/.exec(readFileSync(SW, 'utf8'));
  if (!m) throw new Error('no VERSION line in the built service worker');
  return m[1]!;
}

const original = readFileSync(PROBE, 'utf8');
try {
  build();
  const before = version();
  check('the built worker carries a stamped version', /^nce-study-[0-9a-f]{12}$/.test(before), before);

  build();
  check(
    'rebuilding unchanged source keeps the same version',
    version() === before,
    'otherwise every deploy nags about an update that is not one',
  );

  // A change a user would actually notice.
  writeFileSync(PROBE, original.replace('Ready when you are', 'Ready when you are.'));
  build();
  const after = version();
  check(
    'changing app source changes the worker, so the browser sees an update',
    after !== before,
    `${before} -> ${after}`,
  );
} catch (err: unknown) {
  failed.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  writeFileSync(PROBE, original);
  try {
    build();
  } catch {
    /* restoring the build is best-effort */
  }
}

for (const name of passed) console.log(`  ok    ${name}`);
for (const name of failed) console.log(`  FAIL  ${name}`);
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length > 0 ? 1 : 0);
