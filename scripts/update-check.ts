/**
 * End-to-end check of the "a new version is ready" flow, in a real browser.
 *
 * Unit tests cover the detection logic against a fake registration, but they
 * cannot catch the two things that actually broke here:
 *
 *  - the service worker calling skipWaiting() on install, so nothing ever waits
 *  - the banner being appended to <main>, which every view clears before it
 *    renders, so a correctly-detected update rendered into a wiped element
 *
 * Both need a genuine second deploy to surface, which is why this drives a real
 * Chromium against a real preview server and edits dist/sw.js in between.
 *
 * Requires `npm run build` first. Run with: npx tsx scripts/update-check.ts
 */
import { chromium, type Browser } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = 4187;
const BASE = `http://localhost:${PORT}/nce-study/`;
const SW = 'dist/sw.js';

const passed: string[] = [];
const failed: string[] = [];
const check = (name: string, cond: boolean): void => {
  (cond ? passed : failed).push(name);
};

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server never came up at ${BASE}`);
}

async function main(): Promise<void> {
  if (!existsSync(SW)) throw new Error(`${SW} not found — run "npm run build" first.`);

  // Restored in the finally block: a crashed run that leaves sw.js rewritten
  // makes the *next* run silently pass, because the edit becomes a no-op.
  const originalSw = readFileSync(SW, 'utf8');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: true,
  });
  let browser: Browser | undefined;

  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => failed.push(`page error: ${e.message}`));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
      timeout: 20_000,
    });
    check('no banner on a first, up-to-date load', (await page.locator('.banner.update').count()) === 0);

    // Publish a genuinely different worker so the byte-comparison update check
    // fires. Rewriting the stamped VERSION is the smallest honest change.
    // scripts/sw-version-check.ts covers the other half, and the half that was
    // actually broken: that a real build produces a changed worker at all.
    writeFileSync(SW, originalSw.replace(/const VERSION = '[^']*';/, "const VERSION = 'nce-study-test';"));
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });

    await page.waitForSelector('.banner.update', { timeout: 15_000 });
    check('banner appears once a new worker is waiting', true);
    // The regression that hid it for real: views clear the element they render into.
    check(
      'banner is outside <main>, so the view render does not clear it',
      await page.evaluate(() => !document.querySelector('main .banner.update')),
    );
    check(
      'the view still renders below the banner',
      (await page.locator('main').innerText()).trim().length > 0,
    );

    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__stayed = true;
    });
    await page.getByRole('button', { name: 'Later' }).click();
    check('"Later" hides the banner', (await page.locator('.banner.update').count()) === 0);
    check(
      '"Later" does not reload — dismissing must never cost you the card you are on',
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__stayed === true),
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.banner.update', { timeout: 15_000 });
    check('banner returns on the next load while the worker is still waiting', true);

    await page.getByRole('button', { name: 'Refresh now' }).click();
    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return !!reg && !reg.waiting && reg.active?.state === 'activated';
      },
      { timeout: 15_000 },
    );
    check('"Refresh now" hands over to the waiting worker', true);
    await page.waitForFunction(() => !document.querySelector('.banner.update'), { timeout: 15_000 });
    check('banner is gone after the update applies', true);
    check(
      'the new worker controls the page afterwards',
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
    );
  } finally {
    writeFileSync(SW, originalSw);
    if (browser) await browser.close();
    try {
      process.kill(-server.pid!, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

main()
  .catch((err: unknown) => {
    failed.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    for (const name of passed) console.log(`  ok    ${name}`);
    for (const name of failed) console.log(`  FAIL  ${name}`);
    console.log(`\n${passed.length} passed, ${failed.length} failed`);
    process.exit(failed.length > 0 ? 1 : 0);
  });
