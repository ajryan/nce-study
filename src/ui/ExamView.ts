/**
 * Timed exam simulation.
 *
 * Draws items to the real blueprint proportions and runs against the real
 * clock, so the pacing pressure is genuine. Afterwards, missed items can be
 * pushed back into the SRS queue as lapses — an exam that only produces a
 * score wastes the most useful signal it generates.
 */
import type { AppState } from '../app';
import { blueprint, resolveRefs, domainById } from '../data/loader';
import type { Card } from '../data/schema';
import { el, clear, pct } from './dom';
import { review as scheduleReview, Rating } from '../scheduler/fsrs';
import type { Grade } from 'ts-fsrs';

interface ExamSession {
  items: Card[];
  /** Per item: index into the *shuffled* choice order. */
  answers: Array<number | null>;
  order: number[][];
  flagged: Set<number>;
  index: number;
  startedAt: number;
  durationMs: number;
  finished: boolean;
  endedAt?: number;
}

let session: ExamSession | null = null;
let tick: ReturnType<typeof setInterval> | null = null;

export function renderExam(app: AppState, root: HTMLElement): void {
  clear(root);

  if (!session) {
    root.appendChild(renderSetup(app, root));
    return;
  }
  if (session.finished) {
    root.appendChild(renderResults(app, root));
    return;
  }
  renderQuestion(app, root);
}

// ---- setup -----------------------------------------------------------------

function renderSetup(app: AppState, root: HTMLElement): HTMLElement {
  const exam = blueprint.exam;
  const eligible = app.cards.filter((c) => c.choices && c.choices.length === exam.optionsPerItem);

  const wrap = el('div');
  wrap.appendChild(el('h1', {}, 'Exam simulation'));
  wrap.appendChild(
    el(
      'p',
      { class: 'muted' },
      'A timed practice run that works like the real thing: the same mix of topics, the same ' +
        `${exam.optionsPerItem} answers per question, and the same clock. Useful once you’ve ` +
        'covered a fair bit — and remember, a practice score is just information, not a verdict.',
    ),
  );

  // Show what can actually be drawn per topic, so a thin deck is visible up
  // front rather than silently producing a lopsided test.
  const table = el(
    'table',
    { class: 'grid' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Topic'), el('th', { class: 'num' }, 'Questions'), el('th', { class: 'num' }, 'Cards available'))),
  );
  const tbody = el('tbody');
  let shortfall = 0;

  const plan = examPlan(eligible, exam.scoredItems);
  for (const { domain, wanted, available } of plan) {
    if (available < wanted) shortfall += wanted - available;
    tbody.appendChild(
      el(
        'tr',
        {},
        el('td', {}, domain.name),
        el('td', { class: 'num' }, String(wanted)),
        el(
          'td',
          { class: 'num', style: available < wanted ? 'color:var(--warn)' : '' },
          String(available),
        ),
      ),
    );
  }
  table.appendChild(tbody);
  wrap.appendChild(el('div', { class: 'tablewrap' }, table));

  if (shortfall > 0) {
    wrap.appendChild(
      el(
        'div',
        { class: 'banner warn', style: 'margin-top:1rem' },
        `There aren’t quite enough cards for a perfectly balanced test — we’re short ${shortfall}. ` +
          'It’ll still run, but the topic mix won’t exactly match the real exam.',
      ),
    );
  }

  const lengthSelect = el('select', {}) as HTMLSelectElement;
  for (const n of [25, 50, 100, exam.scoredItems]) {
    lengthSelect.appendChild(el('option', { value: String(n) }, `${n} questions`));
  }
  lengthSelect.value = String(exam.scoredItems);

  wrap.appendChild(
    el(
      'div',
      { class: 'row', style: 'margin-top:1.25rem' },
      el('label', { class: 'small muted' }, 'How many questions?'),
      lengthSelect,
      el(
        'button',
        {
          class: 'btn primary',
          disabled: eligible.length === 0,
          onclick: () => {
            start(app, Number(lengthSelect.value));
            renderExam(app, root);
          },
        },
        'Start the practice test',
      ),
    ),
  );

  if (eligible.length === 0) {
    wrap.appendChild(
      el('p', { class: 'small muted' }, 'There aren’t any multiple-choice cards loaded yet, so there’s nothing to build a test from.'),
    );
  }

  return wrap;
}

function examPlan(eligible: Card[], targetTotal: number) {
  return blueprint.domains.map((domain) => ({
    domain,
    wanted: Math.round((domain.weight / 100) * targetTotal),
    available: eligible.filter((c) => c.domain === domain.id).length,
  }));
}

function start(app: AppState, length: number): void {
  const exam = blueprint.exam;
  const eligible = app.cards.filter((c) => c.choices && c.choices.length === exam.optionsPerItem);

  const picked: Card[] = [];
  for (const { domain, wanted } of examPlan(eligible, length)) {
    const pool = shuffled(eligible.filter((c) => c.domain === domain.id));
    picked.push(...pool.slice(0, wanted));
  }

  // Top up from whatever's left if rounding or a thin domain left us short.
  if (picked.length < length) {
    const used = new Set(picked.map((c) => c.id));
    picked.push(...shuffled(eligible.filter((c) => !used.has(c.id))).slice(0, length - picked.length));
  }

  const items = shuffled(picked).slice(0, length);
  // Scale the clock to the item count so a 25-item mock keeps real pacing.
  const perItemMs = (exam.timeLimitMinutes * 60_000) / exam.scoredItems;

  session = {
    items,
    answers: new Array(items.length).fill(null),
    order: items.map((c) => shuffled(c.choices!.map((_, i) => i))),
    flagged: new Set(),
    index: 0,
    startedAt: Date.now(),
    durationMs: Math.round(perItemMs * items.length),
    finished: false,
  };
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---- question --------------------------------------------------------------

function renderQuestion(app: AppState, root: HTMLElement): void {
  const s = session!;
  const card = s.items[s.index]!;
  const rerender = () => renderExam(app, root);

  const remaining = s.durationMs - (Date.now() - s.startedAt);
  if (remaining <= 0) {
    finish(app);
    rerender();
    return;
  }

  // One interval for the whole session, cleaned up on finish/exit.
  if (!tick) {
    tick = setInterval(() => {
      const timer = document.getElementById('exam-timer');
      if (!session || session.finished) return;
      const left = session.durationMs - (Date.now() - session.startedAt);
      if (left <= 0) {
        finish(app);
        rerender();
        return;
      }
      if (timer) {
        timer.textContent = formatClock(left);
        timer.className = `exam-timer${left < 5 * 60_000 ? ' low' : ''}`;
      }
    }, 1000);
  }

  const answered = s.answers.filter((a) => a !== null).length;

  root.appendChild(
    el(
      'div',
      { class: 'row', style: 'margin-bottom:.75rem' },
      el('span', { class: 'small muted' }, `Question ${s.index + 1} of ${s.items.length} · ${answered} answered`),
      el('span', { class: 'spacer' }),
      el('span', { id: 'exam-timer', class: `exam-timer${remaining < 5 * 60_000 ? ' low' : ''}` }, formatClock(remaining)),
    ),
  );

  const body = el('div', { class: 'card' });
  body.appendChild(el('div', { class: 'prompt' }, card.prompt));

  const list = el('ol', { class: 'choices' });
  s.order[s.index]!.forEach((originalIndex, position) => {
    const choice = card.choices![originalIndex]!;
    const selected = s.answers[s.index] === originalIndex;
    list.appendChild(
      el(
        'li',
        {},
        el(
          'button',
          {
            style: selected ? 'border-color:var(--accent);background:var(--surface-2)' : '',
            onclick: () => {
              s.answers[s.index] = originalIndex;
              rerender();
            },
          },
          el('span', { class: 'key' }, String(position + 1)),
          el('span', {}, choice.text),
        ),
      ),
    );
  });
  body.appendChild(list);
  root.appendChild(body);

  root.appendChild(
    el(
      'div',
      { class: 'row' },
      el(
        'button',
        { class: 'btn', disabled: s.index === 0, onclick: () => { s.index--; rerender(); } },
        '← Previous',
      ),
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            if (s.flagged.has(s.index)) s.flagged.delete(s.index);
            else s.flagged.add(s.index);
            rerender();
          },
        },
        s.flagged.has(s.index) ? 'Unflag' : 'Flag for review',
      ),
      el('span', { class: 'spacer' }),
      s.index < s.items.length - 1
        ? el('button', { class: 'btn primary', onclick: () => { s.index++; rerender(); } }, 'Next →')
        : el(
            'button',
            { class: 'btn primary', onclick: () => { finish(app); rerender(); } },
            'Finish exam',
          ),
    ),
  );

  // Question navigator.
  const nav = el('div', { class: 'exam-nav' });
  s.items.forEach((_, i) => {
    const classes = [
      s.answers[i] !== null ? 'answered' : '',
      s.flagged.has(i) ? 'flagged' : '',
    ].filter(Boolean).join(' ');
    nav.appendChild(
      el(
        'button',
        {
          class: classes,
          'aria-current': i === s.index ? 'true' : 'false',
          onclick: () => { s.index = i; rerender(); },
        },
        String(i + 1),
      ),
    );
  });
  root.appendChild(nav);

  root.appendChild(
    el(
      'div',
      { class: 'row', style: 'margin-top:1.5rem' },
      el(
        'button',
        {
          class: 'btn small',
          onclick: () => { abandon(); rerender(); },
        },
        'Stop this test',
      ),
    ),
  );
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function finish(app: AppState): void {
  if (!session) return;
  session.finished = true;
  session.endedAt = Date.now();
  stopTick();

  // Persist the result. A score shown once and discarded wastes the most
  // exam-like signal the app produces — the trend across attempts is what
  // actually says whether you are getting ready.
  const s = session;
  const byDomain: Record<string, { correct: number; total: number }> = {};
  let correct = 0;
  let unanswered = 0;

  s.items.forEach((card, i) => {
    const chosen = s.answers[i] ?? null;
    const right = chosen !== null && (card.choices![chosen]?.correct ?? false);
    if (chosen === null) unanswered++;
    if (right) correct++;
    const bucket = (byDomain[card.domain] ??= { correct: 0, total: 0 });
    bucket.total++;
    if (right) bucket.correct++;
  });

  void app.repo.recordExamResult({
    id: `exam-${s.startedAt}`,
    at: new Date(s.startedAt).toISOString(),
    total: s.items.length,
    correct,
    unanswered,
    durationMs: (s.endedAt ?? Date.now()) - s.startedAt,
    byDomain,
  });
}

function abandon(): void {
  session = null;
  stopTick();
}

function stopTick(): void {
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
}

/** Called by the shell when navigating away, so the timer doesn't leak. */
export function pauseExamTimer(): void {
  stopTick();
}

// ---- results ---------------------------------------------------------------

function renderResults(app: AppState, root: HTMLElement): HTMLElement {
  const s = session!;
  const rerender = () => renderExam(app, root);

  const graded = s.items.map((card, i) => {
    const chosen = s.answers[i] ?? null;
    const correct = chosen !== null && (card.choices![chosen]?.correct ?? false);
    return { card, chosen, correct };
  });

  const correctCount = graded.filter((g) => g.correct).length;
  const elapsed = (s.endedAt ?? Date.now()) - s.startedAt;

  const wrap = el('div');
  wrap.appendChild(el('h1', {}, 'How your practice test went'));

  const stats = el('div', { class: 'stats' });
  stats.appendChild(
    el('div', { class: 'stat' },
      el('div', { class: 'n' }, pct(correctCount, s.items.length)),
      el('div', { class: 'l' }, 'overall')),
  );
  stats.appendChild(
    el('div', { class: 'stat' },
      el('div', { class: 'n' }, `${correctCount}/${s.items.length}`),
      el('div', { class: 'l' }, 'got right')),
  );
  stats.appendChild(
    el('div', { class: 'stat' },
      el('div', { class: 'n' }, formatClock(elapsed)),
      el('div', { class: 'l' }, 'time taken')),
  );
  stats.appendChild(
    el('div', { class: 'stat' },
      el('div', { class: 'n' }, String(s.answers.filter((a) => a === null).length)),
      el('div', { class: 'l' }, 'left blank')),
  );
  wrap.appendChild(stats);

  wrap.appendChild(
    el(
      'p',
      { class: 'small muted' },
      'There’s no official pass mark to compare this against — the real exam’s cut-off isn’t ' +
        'published as a percentage. Treat this as a guide to where to put your time next, not ' +
        'as a prediction of how you’ll do on the day.',
    ),
  );

  // Per-domain breakdown is the actionable part.
  wrap.appendChild(el('h2', {}, 'How you did by topic'));
  const table = el(
    'table',
    { class: 'grid' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Topic'), el('th', { class: 'num' }, 'Score'), el('th', { class: 'num' }, '%'), el('th', {}, ''))),
  );
  const tbody = el('tbody');
  for (const domain of blueprint.domains) {
    const rows = graded.filter((g) => g.card.domain === domain.id);
    if (rows.length === 0) continue;
    const got = rows.filter((r) => r.correct).length;
    const share = got / rows.length;
    tbody.appendChild(
      el(
        'tr',
        {},
        el('td', {}, domain.name),
        el('td', { class: 'num' }, `${got}/${rows.length}`),
        el('td', { class: 'num' }, pct(got, rows.length)),
        el('td', {}, el('div', { class: 'meter' }, el('div', { class: 'fill', style: `width:${share * 100}%` }))),
      ),
    );
  }
  table.appendChild(tbody);
  wrap.appendChild(el('div', { class: 'tablewrap' }, table));

  // Feed misses back into the SRS.
  const missed = graded.filter((g) => !g.correct);
  const actions = el('div', { class: 'row', style: 'margin:1.25rem 0' });
  const status = el('span', { class: 'small muted' });

  actions.appendChild(
    el(
      'button',
      {
        class: 'btn primary',
        disabled: missed.length === 0,
        onclick: () => {
          void reinjectMissed(app, missed.map((m) => m.card)).then(() => {
            status.textContent = `Done — those ${missed.length} will come back around soon.`;
            app.rebuildQueue();
          });
        },
      },
      missed.length === 1
        ? 'Add the 1 I missed back to my cards'
        : `Add the ${missed.length} I missed back to my cards`,
    ),
  );
  actions.appendChild(el('button', { class: 'btn', onclick: () => { session = null; rerender(); } }, 'Try another test'));
  actions.appendChild(status);
  wrap.appendChild(actions);

  // Full review of every item.
  wrap.appendChild(el('h2', {}, 'Go through every question'));
  graded.forEach((g, i) => {
    const details = el('details', { class: 'browse-item' });
    details.appendChild(
      el(
        'summary',
        {},
        el('span', { style: g.correct ? 'color:var(--correct)' : 'color:var(--wrong)' }, g.correct ? '✓ ' : '✗ '),
        el('span', {}, `${i + 1}. ${g.card.prompt.slice(0, 100)}${g.card.prompt.length > 100 ? '…' : ''}`),
        el('div', { class: 'meta' }, domainById(g.card.domain)?.name ?? g.card.domain),
      ),
    );

    const body = el('div', { style: 'padding:.5rem 0 .75rem' });
    const ul = el('ul', { style: 'margin:.3rem 0;padding-left:1.1rem' });
    g.card.choices!.forEach((choice, ci) => {
      const marks = [choice.correct ? 'correct answer' : null, ci === g.chosen ? 'your answer' : null]
        .filter(Boolean)
        .join(', ');
      ul.appendChild(
        el(
          'li',
          { style: choice.correct ? 'color:var(--correct);font-weight:600' : ci === g.chosen ? 'color:var(--wrong)' : '' },
          choice.text,
          marks ? el('span', { class: 'small muted' }, ` — ${marks}`) : null,
          el('span', { class: 'rationale' }, choice.rationale),
        ),
      );
    });
    body.appendChild(ul);
    body.appendChild(el('div', { class: 'explanation' }, g.card.explanation));

    const refs = resolveRefs(g.card.refs);
    body.appendChild(
      el(
        'div',
        { class: 'refs' },
        el('ul', {}, ...refs.map((r) => el('li', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.label)))),
      ),
    );

    details.appendChild(body);
    wrap.appendChild(details);
  });

  return wrap;
}

/** Grade every missed item as Again so it re-enters the learning queue. */
async function reinjectMissed(app: AppState, cards: Card[]): Promise<void> {
  const now = new Date();
  for (const card of cards) {
    const progress = app.progressFor(card.id);
    if (!progress) continue;
    const { progress: next } = scheduleReview(progress, Rating.Again as Grade, app.settings, now, false);
    await app.repo.recordReview(
      next,
      {
        cardId: card.id,
        at: now.toISOString(),
        rating: Rating.Again,
        correct: false,
        domain: card.domain,
        elapsedMs: 0,
      },
      false,
    );
  }
}
