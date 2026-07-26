/**
 * End-to-end UI integration tests against the real bundled deck.
 *
 * These boot the actual AppState and render each view into a jsdom document, so
 * they catch the class of failure unit tests miss: a view that throws on real
 * card data, a queue that never advances, or progress that silently fails to
 * persist across a reload.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppState, CHECKPOINT_EVERY } from '../src/app';
import { MemoryStore, __setStore } from '../src/storage/db';
import { renderReview, handleReviewKey, resetReviewView } from '../src/ui/ReviewView';
import { renderHome } from '../src/ui/HomeView';
import { renderDashboard } from '../src/ui/DashboardView';
import { renderBrowse } from '../src/ui/BrowseView';
import { renderSettings } from '../src/ui/SettingsView';
import { renderExam } from '../src/ui/ExamView';
import { bundledCards, blueprint } from '../src/data/loader';
import { ProgressRepository } from '../src/storage/progress';

function container(): HTMLElement {
  const el = document.createElement('main');
  document.body.appendChild(el);
  return el;
}

async function bootedApp(patch: Record<string, unknown> = {}): Promise<AppState> {
  __setStore(new MemoryStore());
  const app = new AppState();
  await app.init();
  if (Object.keys(patch).length > 0) {
    await app.repo.updateSettings(patch);
    app.rebuildQueue();
  }
  resetReviewView();
  return app;
}

beforeEach(() => {
  document.body.innerHTML = '';
  resetReviewView();
});

describe('deck loading', () => {
  it('bundles every deck file into the app', () => {
    // Guards against a broken import.meta.glob silently shipping an empty deck.
    expect(bundledCards.length).toBeGreaterThan(500);
  });

  it('every bundled card belongs to a blueprint domain', () => {
    const ids = new Set(blueprint.domains.map((d) => d.id));
    for (const card of bundledCards) expect(ids.has(card.domain)).toBe(true);
  });

  it('card ids are unique across all deck files', () => {
    const ids = bundledCards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('app boot', () => {
  it('creates progress for every card and builds a non-empty queue', async () => {
    const app = await bootedApp();
    expect(app.repo.getProgress().size).toBe(app.cards.length);
    expect(app.queue.length).toBeGreaterThan(0);
  });

  it('respects the daily new-card limit when building the first queue', async () => {
    const app = await bootedApp({ maxNewPerDay: 12 });
    expect(app.queue.length).toBe(12);
  });

  it('reports a storage warning only on a non-durable tier', async () => {
    const app = await bootedApp();
    // MemoryStore is the non-durable fallback, so a warning is expected here.
    expect(app.storageWarning).not.toBeNull();
  });
});

describe('review view', () => {
  it('renders a card without throwing and shows the prompt', async () => {
    const app = await bootedApp();
    const root = container();
    renderReview(app, root);

    expect(root.querySelector('.prompt')).not.toBeNull();
    expect(root.textContent).toContain(app.current!.card.prompt.slice(0, 40));
  });

  it('shows choices for an MCQ and hides rationales until answered', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    // Find an MCQ in the queue and make it current.
    const idx = app.queue.findIndex((i) => i.card.choices);
    expect(idx).toBeGreaterThanOrEqual(0);
    app.queueIndex = idx;

    const root = container();
    renderReview(app, root);

    const buttons = root.querySelectorAll('ol.choices button');
    expect(buttons.length).toBe(blueprint.exam.optionsPerItem);
    expect(root.querySelector('.rationale')).toBeNull();
  });

  it('reveals every rationale and the references after answering', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    app.queueIndex = app.queue.findIndex((i) => i.card.choices);
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    (root.querySelector('ol.choices button') as HTMLButtonElement).click();

    // A rationale for each option, not just the chosen one.
    expect(root.querySelectorAll('.rationale').length).toBe(blueprint.exam.optionsPerItem);
    expect(root.querySelector('.explanation')).not.toBeNull();
    const links = root.querySelectorAll('.refs a');
    expect(links.length).toBeGreaterThan(0);
    expect((links[0] as HTMLAnchorElement).href).toMatch(/^https?:\/\//);
  });

  it('advances to the next card after grading, and persists the answer', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    app.queueIndex = app.queue.findIndex((i) => i.card.choices);
    const first = app.current!.card.id;

    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    (root.querySelector('ol.choices button') as HTMLButtonElement).click();
    const gradeBtn = [...root.querySelectorAll('.grading button')].find((b) =>
      /Good|Again/.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    gradeBtn.click();
    await vi.waitFor(() => expect(app.current?.card.id).not.toBe(first));

    const progress = app.repo.getCard(first)!;
    expect(progress.answerCount).toBe(1);
    expect(app.repo.getLog().length).toBe(1);
  });

  it('reveals a recall card with the keyboard and grades it', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    const idx = app.queue.findIndex((i) => i.card.type === 'recall');
    expect(idx).toBeGreaterThanOrEqual(0);
    app.queueIndex = idx;

    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    // Answer hidden until revealed.
    expect(root.querySelector('.answerbox')).toBeNull();
    handleReviewKey(app, new KeyboardEvent('keydown', { key: ' ' }));
    expect(root.querySelector('.answerbox')).not.toBeNull();

    const before = app.current!.card.id;
    handleReviewKey(app, new KeyboardEvent('keydown', { key: '3' })); // Good
    await vi.waitFor(() => expect(app.current?.card.id).not.toBe(before));
  });

  it('masks the deletion on a cloze card until revealed', async () => {
    const app = await bootedApp({ maxNewPerDay: 600 });
    const idx = app.queue.findIndex((i) => i.card.type === 'cloze');
    expect(idx).toBeGreaterThanOrEqual(0);
    app.queueIndex = idx;

    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    expect(root.querySelector('.cloze-hidden')).not.toBeNull();
    expect(root.querySelector('.prompt')!.textContent).not.toContain('{{');

    handleReviewKey(app, new KeyboardEvent('keydown', { key: ' ' }));
    expect(root.querySelector('.cloze')).not.toBeNull();
  });

  it('keeps the rating controls out of the scrolling card so they stay on screen', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    app.queueIndex = app.queue.findIndex((i) => i.card.choices);
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);
    (root.querySelector('ol.choices button') as HTMLButtonElement).click();

    const bar = root.querySelector('.actionbar');
    expect(bar).not.toBeNull();

    // Rating buttons must live in the sticky bar, never inside the card body,
    // or a long explanation pushes them below the fold.
    const grading = root.querySelector('.grading')!;
    expect(bar!.contains(grading)).toBe(true);
    expect(root.querySelector('.card')!.contains(grading)).toBe(false);

    // And the bar comes after the card, so it pins to the bottom.
    const card = root.querySelector('.card')!;
    expect(card.compareDocumentPosition(bar!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('tucks references behind an expander, collapsed by default', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    app.queueIndex = app.queue.findIndex((i) => i.card.choices);
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);
    (root.querySelector('ol.choices button') as HTMLButtonElement).click();

    const refs = root.querySelector('details.refs') as HTMLDetailsElement;
    expect(refs).not.toBeNull();
    expect(refs.open).toBe(false);
    expect(refs.querySelector('summary')!.textContent).toMatch(/Where this comes from/);
    // The links are still there, just folded away.
    expect(refs.querySelectorAll('a').length).toBeGreaterThan(0);
  });

  it('puts the reveal button in the action bar for recall cards too', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    app.queueIndex = app.queue.findIndex((i) => i.card.type === 'recall');
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    const bar = root.querySelector('.actionbar')!;
    expect(bar.textContent).toContain('Show answer');
  });

  it('re-queues a lapsed card later in the same session', async () => {
    const app = await bootedApp({ maxNewPerDay: 5 });
    const length = app.queue.length;
    const root = container();
    app.onChange = () => renderReview(app, root);

    const card = app.current!;
    await app.answerCurrent(1 as never, false, 1000); // Rating.Again
    expect(app.queue.length).toBe(length + 1);
    expect(app.queue[app.queue.length - 1]!.card.id).toBe(card.card.id);
  });

  it('shows a warm completion screen with next steps when the queue is exhausted', async () => {
    const app = await bootedApp({ maxNewPerDay: 1 });
    const root = container();
    app.onChange = () => renderReview(app, root);
    await app.answerCurrent(3 as never, true, 500);
    renderReview(app, root);

    const done = root.querySelector('.checkpoint');
    expect(done).not.toBeNull();
    // Never a dead end: the user is always offered somewhere to go next.
    expect(root.querySelectorAll('.checkpoint .actions button').length).toBeGreaterThan(0);
    expect(root.textContent).toMatch(/All done for now|Nothing due right now/);
  });

  it('frames a wrong answer as learning rather than failure', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    app.queueIndex = app.queue.findIndex((i) => i.card.choices);
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    // Click whichever option is wrong.
    const order = [...root.querySelectorAll('ol.choices button')] as HTMLButtonElement[];
    const card = app.current!.card;
    const wrongText = card.choices!.find((c) => !c.correct)!.text;
    order.find((b) => b.textContent?.includes(wrongText))!.click();

    const verdict = root.querySelector('.verdict.wrong');
    expect(verdict).not.toBeNull();
    expect(verdict!.textContent).not.toMatch(/wrong|incorrect|failed/i);
  });
});

describe('other views render against real data', () => {
  it('dashboard renders both coverage axes', async () => {
    const app = await bootedApp();
    const root = container();
    renderDashboard(app, root);

    expect(root.textContent).toContain('Your progress by exam topic');
    expect(root.textContent).toContain('Your progress by subject area');
    // Every domain and every core area has a row.
    for (const d of blueprint.domains) expect(root.textContent).toContain(d.name);
    for (const a of blueprint.cacrepAreas) expect(root.textContent).toContain(a.name);
  });

  it('dashboard shows an exam countdown when a date is set', async () => {
    const future = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
    const app = await bootedApp({ examDate: future });
    const root = container();
    renderDashboard(app, root);
    expect(root.textContent).toMatch(/day[s]? until the exam/);
  });

  it('browse renders and filters by topic', async () => {
    const app = await bootedApp();
    const root = container();
    renderBrowse(app, root);
    expect(root.querySelectorAll('.browse-item').length).toBeGreaterThan(0);

    const select = [...root.querySelectorAll('select')].find((s) =>
      s.textContent?.includes('All topics'),
    ) as HTMLSelectElement;
    select.value = 'D6';
    select.dispatchEvent(new Event('change'));

    const d6 = app.cards.filter((c) => c.domain === 'D6').length;
    expect(root.textContent).toContain(`${d6} cards match`);
  });

  it('settings renders and persists a changed setting', async () => {
    const app = await bootedApp();
    const root = container();
    renderSettings(app, root);
    expect(root.textContent).toContain('When is your exam?');

    // Settings copy must stay in plain language — no implementation vocabulary.
    const jargon = /retention|interval|IndexedDB|localStorage|FSRS|domain|schedul(?:er|ing)|JSON|serializ/i;
    expect(root.textContent).not.toMatch(jargon);

    await app.repo.updateSettings({ maxNewPerDay: 33 });
    const reloaded = new ProgressRepository();
    await reloaded.load();
    expect(reloaded.getSettings().maxNewPerDay).toBe(33);
  });

  it('exam setup renders and can draw a full blueprint-proportional exam', async () => {
    const app = await bootedApp();
    const root = container();
    renderExam(app, root);

    expect(root.textContent).toContain('Exam simulation');
    // The deck must be deep enough that no domain is short of its allocation.
    expect(root.textContent).not.toContain('short of a full blueprint-proportional exam');
  });
});

describe('persistence across a reload', () => {
  it('restores answered progress and the review log', async () => {
    const app = await bootedApp({ maxNewPerDay: 3 });
    const answered = app.current!.card.id;
    await app.answerCurrent(3 as never, true, 900);

    // Same backing store, fresh app instance — as if the page reloaded.
    const app2 = new AppState();
    await app2.init();
    expect(app2.repo.getCard(answered)!.answerCount).toBe(1);
    expect(app2.repo.getLog().length).toBe(1);
    expect(app2.repo.getDaily().new).toBe(1);
  });

  it('does not re-serve a card already scheduled into the future', async () => {
    const app = await bootedApp({ maxNewPerDay: 3 });
    const answered = app.current!.card.id;
    await app.answerCurrent(4 as never, true, 900); // Easy → long interval

    const app2 = new AppState();
    await app2.init();
    expect(app2.queue.some((i) => i.card.id === answered)).toBe(false);
  });
});

describe('guided flow', () => {
  it('opens on the home screen rather than dropping straight into cards', async () => {
    const app = await bootedApp();
    expect(app.view).toBe('home');
  });

  it('home offers a path to every main area of the app', async () => {
    const app = await bootedApp();
    const root = container();
    const visited: string[] = [];
    renderHome(app, root, (v) => visited.push(v));

    const paths = [...root.querySelectorAll('button.path')] as HTMLButtonElement[];
    expect(paths.length).toBeGreaterThanOrEqual(4);
    paths.forEach((b) => b.click());
    expect(new Set(visited)).toEqual(new Set(['study', 'dashboard', 'exam', 'browse']));
  });

  it('features studying as the primary path and shows how many are ready', async () => {
    const app = await bootedApp({ maxNewPerDay: 7 });
    const root = container();
    renderHome(app, root, () => {});
    const featured = root.querySelector('button.path.featured');
    expect(featured).not.toBeNull();
    expect(featured!.textContent).toContain('7 cards ready');
  });

  it('pauses for a checkpoint after a chunk and offers a choice', async () => {
    const app = await bootedApp({ maxNewPerDay: 60 });
    const root = container();
    const visited: string[] = [];
    app.onChange = () => renderReview(app, root, (v) => visited.push(v));

    for (let i = 0; i < CHECKPOINT_EVERY; i++) {
      await app.answerCurrent(3 as never, true, 200);
    }
    expect(app.atCheckpoint).toBe(true);

    renderReview(app, root, (v) => visited.push(v));
    expect(root.querySelector('.checkpoint')).not.toBeNull();
    expect(root.textContent).toContain(`That’s ${CHECKPOINT_EVERY} cards done`);

    // Choosing to continue dismisses it and returns to cards.
    const keepGoing = [...root.querySelectorAll('.checkpoint .actions button')].find((b) =>
      b.textContent?.startsWith('Keep going'),
    ) as HTMLButtonElement;
    keepGoing.click();
    expect(app.atCheckpoint).toBe(false);
    expect(root.querySelector('ol.choices, .prompt')).not.toBeNull();
  });

  it('does not re-show the same checkpoint once acknowledged', async () => {
    const app = await bootedApp({ maxNewPerDay: 60 });
    app.onChange = () => {};
    for (let i = 0; i < CHECKPOINT_EVERY; i++) await app.answerCurrent(3 as never, true, 200);
    app.acknowledgeCheckpoint();
    expect(app.atCheckpoint).toBe(false);

    // ...but the next chunk does trigger one.
    for (let i = 0; i < CHECKPOINT_EVERY; i++) await app.answerCurrent(3 as never, true, 200);
    expect(app.atCheckpoint).toBe(true);
  });
});
