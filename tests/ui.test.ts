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
import { formatInterval } from '../src/ui/dom';
import { renderDashboard, resetDashboardView } from '../src/ui/DashboardView';
import { renderBrowse } from '../src/ui/BrowseView';
import { renderSettings, resetSettingsView, suggestNewPerDay } from '../src/ui/SettingsView';
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
  resetDashboardView();
  resetSettingsView();
});

describe('formatInterval', () => {
  it('never abbreviates a unit ambiguously', () => {
    // "1m" was the bug: minute or month, told apart only by an "o".
    expect(formatInterval(1 / 1440)).toBe('1 minute');
    expect(formatInterval(45 / 1440)).toBe('45 minutes');
    expect(formatInterval(3 / 24)).toBe('3 hours');
    expect(formatInterval(1)).toBe('1 day');
    expect(formatInterval(10)).toBe('10 days');
    expect(formatInterval(60)).toBe('2 months');
    expect(formatInterval(400)).toBe('1.1 years');
  });

  it('singularises correctly', () => {
    expect(formatInterval(31)).toBe('1 month');
    expect(formatInterval(366)).toBe('1 year');
  });

  it('handles overdue and zero without nonsense', () => {
    expect(formatInterval(0)).toBe('now');
    expect(formatInterval(-5)).toBe('now');
  });

  it('is always a duration, so callers can prefix it', () => {
    // A point in time like "tomorrow" would produce "in tomorrow".
    for (const d of [0.5, 1, 7, 45, 500]) {
      expect(`in ${formatInterval(d)}`).not.toMatch(/in (tomorrow|today|now)/);
    }
  });
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
    // Cloze prompts render with the {{deletion}} masked, so compare against the
    // leading text before any deletion rather than the raw source.
    const shown = app.current!.card.prompt.split('{{')[0]!.slice(0, 40);
    expect(root.textContent).toContain(shown);
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
    // Whatever the labels say, the first difficulty button always grades.
    const gradeBtn = root.querySelector('.grading button') as HTMLButtonElement;
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

  it('offers a place to write the answer on a short-answer card', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    app.queueIndex = app.queue.findIndex((i) => i.card.type === 'recall');
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    const input = root.querySelector('textarea.answer-input') as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    expect(root.querySelector('.note-hint')!.textContent).toBe(
      'This is just a note. It will be shown next to the real answer the next time you see this question.',
    );
    // Multiple-choice cards have something to do already, so no box there.
    expect(root.querySelector('.answerbox')).toBeNull();
  });

  it('shows what you wrote beside the real answer, and remembers it', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    app.queueIndex = app.queue.findIndex((i) => i.card.type === 'recall');
    const cardId = app.current!.card.id;
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    const input = root.querySelector('textarea.answer-input') as HTMLTextAreaElement;
    input.value = 'a stable supportive relationship';
    input.dispatchEvent(new Event('input'));
    handleReviewKey(app, new KeyboardEvent('keydown', { key: ' ' }));

    // Both are on screen, the attempt above the answer.
    const mine = root.querySelector('.yourgo')!;
    const real = root.querySelector('.answerbox')!;
    expect(mine.textContent).toContain('a stable supportive relationship');
    expect(mine.compareDocumentPosition(real) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // And it is kept for next time.
    await vi.waitFor(() =>
      expect(app.repo.getNote(cardId)).toBe('a stable supportive relationship'),
    );
  });

  it('surfaces a previous note when the card comes round again', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    app.queueIndex = app.queue.findIndex((i) => i.card.type === 'recall');
    const cardId = app.current!.card.id;
    await app.repo.setNote(cardId, 'my earlier attempt');

    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);
    expect(root.querySelector('.note-prev')!.textContent).toContain('my earlier attempt');

    // With nothing typed this time, the old note still stands beside the answer.
    handleReviewKey(app, new KeyboardEvent('keydown', { key: ' ' }));
    const mine = root.querySelector('.yourgo')!;
    expect(mine.textContent).toContain('Your note from last time');
    expect(mine.textContent).toContain('my earlier attempt');
  });

  it('does not store an empty or whitespace-only note', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    app.queueIndex = app.queue.findIndex((i) => i.card.type === 'recall');
    const cardId = app.current!.card.id;
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    const input = root.querySelector('textarea.answer-input') as HTMLTextAreaElement;
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    handleReviewKey(app, new KeyboardEvent('keydown', { key: ' ' }));

    expect(app.repo.getNote(cardId)).toBeUndefined();
    expect(root.querySelector('.yourgo')).toBeNull();
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
  it('dashboard reaches both coverage axes through the switcher', async () => {
    const app = await bootedApp();
    const root = container();
    renderDashboard(app, root);

    // Exam topics are the default view.
    for (const d of blueprint.domains) expect(root.textContent).toContain(d.name);

    // The other axis is one click away, not a second table.
    const subjectTab = [...root.querySelectorAll('.switch button')].find((b) =>
      /subject/i.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    expect(subjectTab).toBeDefined();
    subjectTab.click();
    for (const a of blueprint.cacrepAreas) expect(root.textContent).toContain(a.name);

    // One table on screen at a time.
    expect(root.querySelectorAll('table.grid').length).toBe(1);
  });

  it('dashboard shows an exam countdown when a date is set', async () => {
    const future = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
    const app = await bootedApp({ examDate: future });
    const root = container();
    renderDashboard(app, root);
    expect(root.textContent).toMatch(/day[s]? until your exam/);
  });

  it('the headline moves after a single answered card', async () => {
    // The old headline was stability-based and read 0% however well a first
    // session went, which is demoralising and uninformative.
    const app = await bootedApp({ maxNewPerDay: 40 });
    const root = container();

    renderDashboard(app, root);
    expect(root.querySelector('.headline .big')!.textContent).toBe('0');

    await app.answerCurrent(3 as never, true, 500);
    renderDashboard(app, root);
    // One card in 512 is 0% when rounded, so the headline is a count.
    expect(root.querySelector('.headline .big')!.textContent).toBe('1');
  });

  it('every bar decomposes the headline into the same three states', async () => {
    const app = await bootedApp({ maxNewPerDay: 40 });
    await app.answerCurrent(3 as never, true, 500);
    const root = container();
    renderDashboard(app, root);

    // Headline bar plus one per row, all the same component.
    const stacks = root.querySelectorAll('.stack');
    expect(stacks.length).toBe(1 + blueprint.domains.length);
    for (const stack of stacks) {
      expect(stack.querySelector('.seg.solid')).not.toBeNull();
      expect(stack.querySelector('.seg.learning')).not.toBeNull();
    }
    // The legend names the three states the segments represent.
    const legend = root.querySelector('.legend')!.textContent!;
    expect(legend).toMatch(/solid/);
    expect(legend).toMatch(/still learning/);
    expect(legend).toMatch(/not started/);
  });

  it('rates on one scale, with "wrong" kept off it', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    app.queueIndex = app.queue.findIndex((i) => i.card.choices);
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    // Answer correctly, so the difficulty scale is what's offered.
    const card = app.current!.card;
    const right = card.choices!.find((c) => c.correct)!.text;
    ([...root.querySelectorAll('ol.choices button')] as HTMLButtonElement[])
      .find((b) => b.textContent?.includes(right))!
      .click();

    expect(root.querySelector('.grading-prompt')!.textContent).toMatch(/how hard was that/i);

    // Every offered label answers "how hard was that?" — none judges the answer.
    const labels = [...root.querySelectorAll('.grading button')].map((b) =>
      (b.textContent ?? '').split('(')[0]!.trim(),
    );
    expect(labels.some((l) => /good/i.test(l))).toBe(false);
    expect(labels.some((l) => /easy/i.test(l))).toBe(true);
    // A correct answer never offers "didn't know it".
    expect(labels.some((l) => /didn’t know/i.test(l))).toBe(false);
  });

  it('states when a card returns once, not under every button', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    app.queueIndex = app.queue.findIndex((i) => i.card.type === 'recall');
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);
    handleReviewKey(app, new KeyboardEvent('keydown', { key: ' ' }));

    // Each rating label is itself a span of time ("Took a moment"), so a second
    // time phrase directly beneath it read as part of the same phrase.
    const buttons = [...root.querySelectorAll('.grading button')];
    expect(buttons.length).toBeGreaterThan(1);
    for (const b of buttons) expect(b.textContent).not.toMatch(/\bin \d+ (day|hour|minute|month)/i);

    const readout = root.querySelector('.next-showing') as HTMLElement;
    expect(root.querySelectorAll('.next-showing')).toHaveLength(1);
    // Useful before anything is hovered, because a touchscreen never hovers.
    expect(readout.textContent).toMatch(/^Show again (in \d|shortly)/);

    // Hover and keyboard focus both drive it, and it goes back afterwards.
    const resting = readout.textContent;
    const easy = buttons.find((b) => /easy/i.test(b.textContent ?? ''))!;
    easy.dispatchEvent(new Event('mouseenter'));
    expect(readout.textContent).toMatch(/^Show again /);
    expect(readout.textContent).not.toBe(resting);
    easy.dispatchEvent(new Event('mouseleave'));
    expect(readout.textContent).toBe(resting);

    easy.dispatchEvent(new FocusEvent('focus'));
    expect(readout.textContent).not.toBe(resting);
    easy.dispatchEvent(new FocusEvent('blur'));
    expect(readout.textContent).toBe(resting);
  });

  it('does not promise a return date for a card being hidden', async () => {
    const app = await bootedApp({ maxNewPerDay: 400 });
    app.queueIndex = app.queue.findIndex((i) => i.card.type === 'recall');
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);
    handleReviewKey(app, new KeyboardEvent('keydown', { key: ' ' }));

    const readout = root.querySelector('.next-showing') as HTMLElement;
    const hideBtn = [...root.querySelectorAll('.grading button')].find((b) =>
      /hide this card/i.test(b.textContent ?? ''),
    )!;
    hideBtn.dispatchEvent(new Event('mouseenter'));
    expect(readout.textContent).not.toMatch(/Show again/);
    expect(readout.textContent).toMatch(/stops coming up/i);
  });

  it('marks "didn\'t know it" apart from the difficulty scale after a wrong answer', async () => {
    const app = await bootedApp({ maxNewPerDay: 200 });
    app.queueIndex = app.queue.findIndex((i) => i.card.choices);
    const root = container();
    app.onChange = () => renderReview(app, root);
    renderReview(app, root);

    const card = app.current!.card;
    const wrong = card.choices!.find((c) => !c.correct)!.text;
    ([...root.querySelectorAll('ol.choices button')] as HTMLButtonElement[])
      .find((b) => b.textContent?.includes(wrong))!
      .click();

    const again = root.querySelector('.grading button.again');
    expect(again).not.toBeNull();
    expect(again!.textContent).toMatch(/didn’t know it/i);
  });

  it('drops vocabulary that does not appear on the rating buttons', async () => {
    const app = await bootedApp();
    const root = container();
    renderDashboard(app, root);
    // "Sticking" and "feeling solid" meant nothing to the user — neither is a
    // rating they can give, so neither should describe their progress.
    expect(root.textContent).not.toMatch(/sticking|feeling solid/i);
  });

  it('shows a placeholder before any practice test has been taken', async () => {
    const app = await bootedApp();
    const root = container();
    const visited: string[] = [];
    renderDashboard(app, root, (v) => visited.push(v));

    const panel = root.querySelector('.empty-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('No practice tests yet');
    // The placeholder explains the value and offers the action, rather than
    // being an empty box.
    (panel.querySelector('button') as HTMLButtonElement).click();
    expect(visited).toEqual(['exam']);
  });

  it('shows the most recent score and a per-topic breakdown once a test exists', async () => {
    const app = await bootedApp();
    await app.repo.recordExamResult({
      id: 'e1',
      at: new Date().toISOString(),
      total: 10,
      correct: 7,
      unanswered: 0,
      durationMs: 600_000,
      byDomain: { D1: { correct: 3, total: 4 }, D5: { correct: 4, total: 6 } },
    });

    const root = container();
    renderDashboard(app, root);
    expect(root.querySelector('.empty-panel')).toBeNull();
    expect(root.textContent).toContain('70%');
    expect(root.textContent).toContain('most recent');
    // Named topics, not domain codes.
    expect(root.textContent).toContain('Professional Practice and Ethics');
    expect(root.textContent).toContain('3/4');
  });

  it('reports the change between the last two tests', async () => {
    const app = await bootedApp();
    const base = {
      at: new Date().toISOString(),
      total: 10,
      unanswered: 0,
      durationMs: 1000,
      byDomain: {},
    };
    await app.repo.recordExamResult({ ...base, id: 'e1', correct: 5 });
    await app.repo.recordExamResult({ ...base, id: 'e2', correct: 8 });

    const root = container();
    renderDashboard(app, root);
    expect(root.textContent).toContain('+30');
    expect(root.textContent).toContain('points since last time');
    expect(root.querySelectorAll('.trend .tbar').length).toBe(2);
  });

  it('keeps practice results out of the coverage headline', async () => {
    // Blending "how much have I seen" with "how did I score" makes the headline
    // uninterpretable; the interesting part is where the two disagree.
    const app = await bootedApp();
    const root = container();
    renderDashboard(app, root);
    const before = root.querySelector('.headline .big')!.textContent;

    await app.repo.recordExamResult({
      id: 'e1', at: new Date().toISOString(), total: 10, correct: 10,
      unanswered: 0, durationMs: 1000, byDomain: {},
    });
    renderDashboard(app, root);
    expect(root.querySelector('.headline .big')!.textContent).toBe(before);
  });

  it('hides the forecast entirely when nothing is scheduled', async () => {
    const app = await bootedApp();
    const root = container();
    renderDashboard(app, root);
    expect(root.textContent).not.toContain('What’s coming up');
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

  it('confirms a saved setting beside the field that changed', async () => {
    const app = await bootedApp();
    const root = container();
    renderSettings(app, root);
    expect(root.querySelector('.saved-chip')).toBeNull();

    const newPerDay = [...root.querySelectorAll('input[type="number"]')].find(
      (i) => (i as HTMLInputElement).max === '500',
    ) as HTMLInputElement;
    newPerDay.value = '17';
    newPerDay.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.querySelector('.saved-chip')).not.toBeNull());

    // Beside the field that changed, not floating somewhere unrelated: an
    // anxious user should not have to work out which control the message is about.
    const chip = root.querySelector('.saved-chip')!;
    const field = chip.closest('.field')!;
    expect(field.textContent).toContain('New cards a day');
    expect(root.querySelectorAll('.saved-chip')).toHaveLength(1);

    // And it really saved, rather than only claiming to.
    const reloaded = new ProgressRepository();
    await reloaded.load();
    expect(reloaded.getSettings().maxNewPerDay).toBe(17);
  });

  it('clears the saved confirmation after a moment', async () => {
    vi.useFakeTimers();
    try {
      const app = await bootedApp();
      const root = container();
      app.onChange = () => renderSettings(app, root);
      renderSettings(app, root);

      const box = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(root.querySelector('.saved-chip')).not.toBeNull());

      await vi.advanceTimersByTimeAsync(5000);
      expect(root.querySelector('.saved-chip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never puts the confirmation inside a checkbox label, where clicking it would toggle the setting', async () => {
    const app = await bootedApp();
    const root = container();
    renderSettings(app, root);

    const box = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.querySelector('.saved-chip')).not.toBeNull());

    expect(root.querySelector('label .saved-chip')).toBeNull();
  });

  it('offers a daily new-card number when the exam date leaves too little time', async () => {
    // 512 cards and a fortnight: 20 a day cannot get through them.
    const app = await bootedApp({ maxNewPerDay: 20 });
    const root = container();
    app.onChange = () => renderSettings(app, root);
    renderSettings(app, root);

    const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const dateInput = root.querySelector('input[type="date"]') as HTMLInputElement;
    dateInput.value = soon;
    dateInput.dispatchEvent(new Event('change'));

    const dialog = await vi.waitFor(() => {
      const d = root.querySelector('dialog.pacing');
      expect(d).not.toBeNull();
      return d as HTMLElement;
    });

    // It must do the arithmetic, not report a shortfall and leave the user to it.
    const suggested = suggestNewPerDay(app)!;
    expect(suggested).toBeGreaterThan(20);
    const apply = [...dialog.querySelectorAll('button')].find((b) =>
      b.textContent!.includes(String(suggested)),
    ) as HTMLButtonElement;
    expect(apply).toBeDefined();

    apply.click();
    await vi.waitFor(() => expect(root.querySelector('dialog.pacing')).toBeNull());
    expect(app.settings.maxNewPerDay).toBe(suggested);

    // Applied for real, not just in memory.
    const reloaded = new ProgressRepository();
    await reloaded.load();
    expect(reloaded.getSettings().maxNewPerDay).toBe(suggested);
  });

  it('stays quiet when the current pace is already enough', async () => {
    const app = await bootedApp({ maxNewPerDay: 40 });
    const root = container();
    app.onChange = () => renderSettings(app, root);
    renderSettings(app, root);

    // Three years out: the required pace is a floor, not a target, so
    // suggesting the user *slow down* to it would be bad advice.
    const distant = new Date(Date.now() + 1095 * 864e5).toISOString().slice(0, 10);
    const dateInput = root.querySelector('input[type="date"]') as HTMLInputElement;
    dateInput.value = distant;
    dateInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(app.settings.examDate).toBe(distant));
    expect(suggestNewPerDay(app)).toBeNull();
    expect(root.querySelector('dialog.pacing')).toBeNull();
  });

  it('does not offer a pace for an exam date that has already passed', async () => {
    const app = await bootedApp({ maxNewPerDay: 5 });
    await app.updateSettings({ examDate: '2020-01-01' });
    // requiredNewPerDay is Infinity here; there is no honest number to offer.
    expect(suggestNewPerDay(app)).toBeNull();
  });

  it('lets the user keep their current pace', async () => {
    const app = await bootedApp({ maxNewPerDay: 20 });
    const root = container();
    app.onChange = () => renderSettings(app, root);
    renderSettings(app, root);

    const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const dateInput = root.querySelector('input[type="date"]') as HTMLInputElement;
    dateInput.value = soon;
    dateInput.dispatchEvent(new Event('change'));

    const dialog = await vi.waitFor(() => {
      const d = root.querySelector('dialog.pacing');
      expect(d).not.toBeNull();
      return d as HTMLElement;
    });

    const keep = [...dialog.querySelectorAll('button')].find((b) =>
      b.textContent!.startsWith('Keep'),
    ) as HTMLButtonElement;
    keep.click();

    await vi.waitFor(() => expect(root.querySelector('dialog.pacing')).toBeNull());
    expect(app.settings.maxNewPerDay).toBe(20);
    // And it does not come back on the next render.
    renderSettings(app, root);
    expect(root.querySelector('dialog.pacing')).toBeNull();
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

    const paths = [...root.querySelectorAll('.path')] as HTMLElement[];
    expect(paths.length).toBeGreaterThanOrEqual(4);

    // Every card carries an explicit button — a hover state alone said nothing
    // on touch, and left the entry point ambiguous.
    for (const card of paths) {
      const cta = card.querySelector('button.cta');
      expect(cta).not.toBeNull();
      expect((cta!.textContent ?? '').trim().length).toBeGreaterThan(0);
    }

    // Only the buttons navigate — the cards themselves are not click targets.
    (paths.map((c) => c.querySelector('button.cta')) as HTMLButtonElement[]).forEach((b) =>
      b.click(),
    );
    expect(new Set(visited)).toEqual(new Set(['study', 'dashboard', 'exam', 'browse']));
  });

  it('prompts for the exam date when it is not set, above the study card', async () => {
    const app = await bootedApp();
    const root = container();
    const visited: string[] = [];
    renderHome(app, root, (v) => visited.push(v));

    const nudge = root.querySelector('.datenudge');
    expect(nudge).not.toBeNull();
    expect(nudge!.textContent).toContain('When is your exam?');

    // Above the study card, not tucked in a footer.
    const featured = root.querySelector('.path.featured')!;
    expect(nudge!.compareDocumentPosition(featured) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    (nudge!.querySelector('button') as HTMLButtonElement).click();
    expect(visited).toEqual(['settings']);
  });

  it('drops the exam-date prompt once a date is set', async () => {
    const future = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const app = await bootedApp({ examDate: future });
    const root = container();
    renderHome(app, root, () => {});
    expect(root.querySelector('.datenudge')).toBeNull();
  });

  it('navigates only from the button, not from the card body', async () => {
    const app = await bootedApp();
    const root = container();
    const visited: string[] = [];
    renderHome(app, root, (v) => visited.push(v));

    const card = root.querySelector('.path.featured') as HTMLElement;

    // Clicking the card itself, its title, and its description must do nothing.
    card.click();
    (card.querySelector('.title') as HTMLElement).click();
    (card.querySelector('.desc') as HTMLElement).click();
    expect(visited).toEqual([]);

    // Only the button navigates.
    (card.querySelector('button.cta') as HTMLButtonElement).click();
    expect(visited).toEqual(['study']);
  });

  it('features studying as the primary path and shows how many are ready', async () => {
    const app = await bootedApp({ maxNewPerDay: 7 });
    const root = container();
    renderHome(app, root, () => {});
    const featured = root.querySelector('.path.featured');
    expect(featured).not.toBeNull();
    expect(featured!.textContent).toContain('7 cards ready');
    expect(featured!.querySelector('button.cta')!.textContent).toMatch(/start studying/i);
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
