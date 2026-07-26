/**
 * Drives the real app in a real browser and checks the things jsdom cannot see.
 *
 * jsdom has no layout engine, so it can tell you the rating bar is *in the DOM*
 * but not that it is *on screen*. `position: sticky` in particular behaves
 * differently depending on its containing block, and a scrollbar appearing can
 * shift the whole layout sideways. Both need a browser to catch.
 *
 *   npm run visual          # headless, exits non-zero on failure
 *   npm run visual -- --ui  # headed, so you can watch it
 *
 * Screenshots land in .screenshots/ (gitignored).
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const HEADED = process.argv.includes('--ui');
const PORT = 4178;
const BASE = `http://localhost:${PORT}/nce-study/`;
const SHOTS = '.screenshots';

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(`${label}${detail ? `: ${detail}` : ''}`);
  }
}

async function startServer(): Promise<() => void> {
  const proc = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', detached: true },
  );
  // Wait for it to answer.
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return () => {
    try {
      process.kill(-proc.pid!, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
}

/** Click through the home screen into a card and answer it. */
async function answerOneCard(page: Page): Promise<void> {
  await page.locator('.path.featured button.cta').click();
  await page.waitForSelector('.prompt');
  const choice = page.locator('ol.choices button').first();
  if (await choice.count()) {
    await choice.click();
  } else {
    await page.getByRole('button', { name: /Show answer/i }).click();
  }
  await page.waitForSelector('.actionbar .grading');
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const stop = await startServer();
  const browser = await chromium.launch({ headless: !HEADED });

  try {
    // A deliberately short viewport — this is where "below the fold" bites.
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    // ---- home ----
    await page.waitForSelector('.path.featured');
    await page.screenshot({ path: `${SHOTS}/1-home.png` });
    check((await page.locator('.path').count()) >= 4, 'home shows the choose-your-path options');

    // Every card must carry a visible button — hover alone signals nothing on
    // touch, and this is the entry point to everything else.
    const ctas = page.locator('.path button.cta');
    check((await ctas.count()) >= 4, 'every home card has an explicit call-to-action button');
    check(await ctas.first().isVisible(), 'call-to-action buttons are visible');

    // ...and all four have to clear the fold at ordinary viewport sizes.
    for (const [w, h, label] of [
      [1000, 700, 'laptop'],
      [1440, 800, 'desktop'],
      [390, 780, 'phone'],
    ] as Array<[number, number, string]>) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(180);
      const lowest = await page.locator('.path').last().evaluate((el) => el.getBoundingClientRect().bottom);
      check(
        lowest <= h,
        `all four home cards are above the fold (${label} ${w}x${h})`,
        `last card ends at ${Math.round(lowest)}px`,
      );
    }
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForTimeout(150);

    // ---- layout shift when a scrollbar appears ----
    // Measure the content box with and without forced overflow.
    const shift = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const before = main.getBoundingClientRect().width;
      const probe = document.createElement('div');
      probe.style.height = '5000px';
      document.body.appendChild(probe);
      const after = main.getBoundingClientRect().width;
      probe.remove();
      return { before, after, delta: Math.abs(before - after) };
    });
    check(
      shift.delta === 0,
      'layout does not shift when a scrollbar appears',
      `main width ${shift.before}px → ${shift.after}px (delta ${shift.delta}px)`,
    );

    // ---- study: the sticky rating bar ----
    await answerOneCard(page);
    await page.screenshot({ path: `${SHOTS}/2-answered.png` });

    const vh = page.viewportSize()!.height;
    const barTop = async () =>
      page.locator('.actionbar').evaluate((el) => el.getBoundingClientRect().top);
    const barBottom = async () =>
      page.locator('.actionbar').evaluate((el) => el.getBoundingClientRect().bottom);

    check((await barTop()) < vh, 'rating bar is on screen right after answering',
      `top ${Math.round(await barTop())}px, viewport ${vh}px`);

    // Scroll to the very bottom and confirm it is still pinned.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    const bottomAfterScroll = await barBottom();
    check(
      bottomAfterScroll <= vh + 2 && (await barTop()) < vh,
      'rating bar stays pinned after scrolling to the bottom',
      `bar bottom ${Math.round(bottomAfterScroll)}px vs viewport ${vh}px`,
    );

    // And halfway, which is where sticky most often breaks.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(200);
    check((await barTop()) < vh, 'rating bar visible mid-scroll too');
    await page.screenshot({ path: `${SHOTS}/3-scrolled.png` });

    // Rating buttons genuinely clickable where they sit.
    const good = page.locator('.actionbar .grading button').first();
    check(await good.isVisible(), 'rating buttons are visible and hittable');

    // ---- references collapsed ----
    const refs = page.locator('details.refs');
    if (await refs.count()) {
      check(!(await refs.first().evaluate((el: HTMLDetailsElement) => el.open)),
        'references start collapsed');
      await refs.first().locator('summary').click();
      check(await refs.first().locator('a').first().isVisible(),
        'references expand on click');
    }

    // ---- narrow viewport ----
    await page.setViewportSize({ width: 390, height: 720 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/4-mobile.png` });
    const overflowsX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    check(!overflowsX, 'no horizontal overflow at 390px wide');
    check((await barTop()) < 720, 'rating bar still on screen on a phone-sized viewport');

    check(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '));
    notes.push(`screenshots written to ${SHOTS}/`);
  } finally {
    await browser.close();
    stop();
  }
}

console.log('Visual checks (real browser)\n');
await main();
notes.forEach((n) => console.log(`\n${n}`));

if (failures.length > 0) {
  console.log(`\nFAILED — ${failures.length} check(s):`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('\nAll visual checks passed.');
