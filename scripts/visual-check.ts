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
      const withNudge = (await page.locator('.datenudge').count()) > 0;
      check(
        lowest <= h,
        `all four home cards are above the fold (${label} ${w}x${h}${withNudge ? ', exam-date prompt showing' : ''})`,
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

    // ---- when the card comes back ----
    // Hover is the whole mechanism here, and jsdom cannot hover.
    // A wrongly-answered MCQ offers only "Didn't know it", so advance until a
    // card shows the full difficulty scale and there are two values to compare.
    const ratings = () =>
      page.locator('.actionbar .grading button').filter({ hasNotText: 'Hide this card' });
    for (let i = 0; i < 12 && (await ratings().count()) < 3; i++) {
      await ratings().first().click();
      await page.waitForTimeout(150);
      if ((await page.locator('.prompt').count()) === 0) break;
      const choice = page.locator('ol.choices button').first();
      if (await choice.count()) await choice.click();
      else await page.getByRole('button', { name: /Show answer/i }).click();
      await page.waitForSelector('.actionbar .grading');
    }
    check((await ratings().count()) >= 3, 'a card offers the full difficulty scale',
      `${await ratings().count()} rating buttons`);

    const readout = page.locator('.next-showing');
    const resting = (await readout.innerText()).trim();
    check(/^Show again (in \d|shortly)/.test(resting),
      'the return time reads as a sentence before anything is hovered', resting);
    const barBefore = (await page.locator('.actionbar').boundingBox())!.height;

    const easy = ratings().last();
    await easy.hover();
    const hovered = (await readout.innerText()).trim();
    check(hovered !== resting && /^Show again /.test(hovered),
      'hovering a rating updates it', `${resting} -> ${hovered}`);

    const hideBtn = page.locator('.actionbar .grading button', { hasText: 'Hide this card' });
    await hideBtn.hover();
    check(!/Show again/.test(await readout.innerText()),
      'hiding a card does not claim a return time', (await readout.innerText()).trim());

    // The bar is sticky and sits over the card, so it must not resize as the
    // text changes underneath the cursor.
    const barAfter = (await page.locator('.actionbar').boundingBox())!.height;
    check(Math.abs(barAfter - barBefore) < 1,
      'the sticky bar does not resize as the readout changes',
      `${Math.round(barBefore)}px -> ${Math.round(barAfter)}px`);

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

    // ---- routing ----
    // The point of the URLs is surviving a refresh, and nothing short of a real
    // browser reload proves that. Back/forward matter just as much: the whole
    // app lived at one address, so Back used to leave the site entirely.
    await page.setViewportSize({ width: 1000, height: 700 });

    // Scoped to the tab bar: the home screen has its own "See my progress"
    // button, and an unscoped role query matches both.
    const tab = (label: string) => page.locator('nav.tabs button', { hasText: label });
    const current = () => page.locator('nav.tabs button[aria-current="page"]').innerText();
    const hashBecomes = async (expected: string): Promise<boolean> => {
      try {
        await page.waitForFunction((h) => location.hash === h, expected, { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    };

    await page.goto(BASE, { waitUntil: 'networkidle' });
    check(await hashBecomes('#/start'), 'the first load names itself in the URL', page.url());

    await tab('My Progress').click();
    check(await hashBecomes('#/progress'), 'moving to a section changes the URL');

    await page.reload({ waitUntil: 'networkidle' });
    check(
      (await hashBecomes('#/progress')) && (await current()).includes('My Progress'),
      'a refresh comes back to the same section',
    );

    await tab('Settings').click();
    await hashBecomes('#/settings');
    await page.goBack();
    check(
      (await hashBecomes('#/progress')) && (await current()).includes('My Progress'),
      'Back returns to the previous section instead of leaving the app',
    );

    await page.goForward();
    check(
      (await hashBecomes('#/settings')) && (await current()).includes('Settings'),
      'Forward works too',
    );

    // A hand-typed URL or a stale bookmark must land somewhere, not on a blank page.
    await page.goto(`${BASE}#/nonsense`, { waitUntil: 'networkidle' });
    check(
      (await hashBecomes('#/start')) && (await page.locator('main').innerText()).trim().length > 0,
      'an unrecognised URL falls back to Start rather than an empty page',
    );

    // ---- settings save confirmation ----
    // jsdom can prove the chip is in the DOM but not that anyone can see it.
    await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.field');
    const newPerDay = page.locator('input[type="number"]').first();
    await newPerDay.fill('17');
    await newPerDay.blur();
    const chip = page.locator('.saved-chip');
    await chip.waitFor({ timeout: 5000 });
    check(await chip.isVisible(), 'a changed setting confirms itself on screen');
    const box = await chip.boundingBox();
    check(
      !!box && box.width > 0 && box.height > 0 && box.y < 700,
      'the confirmation is on screen next to the field, not off in a corner',
      box ? `at ${Math.round(box.x)},${Math.round(box.y)}` : 'no box',
    );
    await page.waitForTimeout(3200);
    check((await chip.count()) === 0, 'the confirmation clears itself after a moment');

    // ---- pacing prompt on an exam-date change ----
    // jsdom has no <dialog> at all, so the modal behaviour is only ever
    // exercised here: top layer, backdrop, and Escape to dismiss.
    const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const dateField = page.locator('input[type="date"]');
    await dateField.fill(soon);
    await dateField.blur();
    const modal = page.locator('dialog.pacing');
    await modal.waitFor({ timeout: 5000 });
    check(
      await modal.evaluate((d: HTMLDialogElement) => d.matches(':modal')),
      'a tight exam date offers a daily pace, as a real modal in the top layer',
    );

    // Regression: the "Saved" chip timer fired a full re-render 2.6s later,
    // which rebuilt <main> detached and called showModal() on a node that was
    // not in the document yet. That threw after rootEl had been cleared, so the
    // whole page went blank a few seconds after the prompt appeared.
    await page.waitForTimeout(4000);
    check(
      (await page.locator('main').count()) === 1 &&
        (await page.locator('body').innerText()).trim().length > 500,
      'the page does not blank out while the prompt sits open',
      `body text ${(await page.locator('body').innerText()).trim().length} chars`,
    );
    check(await modal.isVisible(), 'the prompt is still there, not torn down and rebuilt');
    check(errors.length === 0, 'no error thrown while the prompt is open',
      errors.slice(0, 2).join(' | '));

    // The above only proves the chip timer no longer re-renders. A re-render
    // can still arrive from elsewhere (the update banner, any onChange), so
    // force one and prove <main> is attached before the view draws into it —
    // showModal() on a detached node is what blanked the page.
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    await page.waitForTimeout(300);
    check(
      (await page.locator('main').count()) === 1 &&
        (await page.locator('body').innerText()).trim().length > 500 &&
        !(await page.locator('body').innerText()).includes('Something went wrong'),
      'a re-render while the prompt is open does not blank or break the page',
      `body text ${(await page.locator('body').innerText()).trim().length} chars`,
    );
    check(
      errors.length === 0,
      'and throws nothing doing it',
      errors.slice(0, 2).join(' | '),
    );
    // The sharp end of the ordering fix: <main> must be attached before the
    // view draws, or showModal() cannot run and the prompt silently becomes an
    // invisible <dialog> sitting in the page.
    check(
      await modal.evaluate((d: HTMLDialogElement) => d.matches(':modal')),
      'and the prompt survives that re-render as a real modal',
    );

    const before = await newPerDay.inputValue();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached', timeout: 5000 });
    check(
      (await newPerDay.inputValue()) === before,
      'Escape dismisses the prompt without changing anything',
    );

    await dateField.fill(new Date(Date.now() + 13 * 864e5).toISOString().slice(0, 10));
    await dateField.blur();
    await modal.waitFor({ timeout: 5000 });
    const applyLabel = await page.locator('dialog.pacing .btn.primary').innerText();
    await page.locator('dialog.pacing .btn.primary').click();
    await modal.waitFor({ state: 'detached', timeout: 5000 });
    check(
      applyLabel.includes(await newPerDay.inputValue()),
      'accepting it applies that exact number to the field',
      `${applyLabel} → ${await newPerDay.inputValue()}`,
    );

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
