/**
 * The study loop.
 *
 * Keyboard-first, because a session is hundreds of repetitions and reaching for
 * the mouse each time is the difference between studying and not:
 *   1-4 / a-d   select an MCQ option
 *   space       reveal a recall/cloze card
 *   1-4         grade after reveal (Again / Hard / Good / Easy)
 *   s           suspend the current card
 *
 * After answering, *every* option's rationale is shown, not just the chosen
 * one. Knowing why the three distractors are wrong is most of the learning on
 * an application-heavy exam.
 */
import type { AppState, ViewName } from '../app';
import { CHECKPOINT_EVERY } from '../app';
import type { Card, Choice } from '../data/schema';
import { resolveRefs, taskLabel, domainById } from '../data/loader';
import { el, clear, frag, formatInterval, renderCloze, pct } from './dom';
import { previewIntervals, Rating } from '../scheduler/fsrs';
import type { Grade } from 'ts-fsrs';

const CHOICE_KEYS = ['1', '2', '3', '4', '5'];
const GRADE_LABELS: Array<{ grade: Grade; label: string; key: string }> = [
  { grade: Rating.Again as Grade, label: 'Again', key: '1' },
  { grade: Rating.Hard as Grade, label: 'Hard', key: '2' },
  { grade: Rating.Good as Grade, label: 'Good', key: '3' },
  { grade: Rating.Easy as Grade, label: 'Easy', key: '4' },
];

interface ViewLocalState {
  revealed: boolean;
  selectedIndex: number | null;
  shownAt: number;
  /** Choice order is shuffled per presentation so position isn't memorised. */
  order: number[];
}

let local: ViewLocalState = { revealed: false, selectedIndex: null, shownAt: Date.now(), order: [] };
let boundCardId: string | null = null;

function resetLocal(card: Card): void {
  const count = card.choices?.length ?? 0;
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  local = { revealed: false, selectedIndex: null, shownAt: Date.now(), order };
  boundCardId = card.id;
}

export function renderReview(app: AppState, root: HTMLElement, go?: (view: ViewName) => void): void {
  clear(root);

  const navigate = go ?? (() => {});

  // A finished chunk gets a pause and a choice before the next one starts.
  if (app.atCheckpoint) {
    root.appendChild(renderCheckpoint(app, navigate));
    return;
  }

  const item = app.current;
  if (!item) {
    root.appendChild(renderComplete(app, navigate));
    return;
  }

  const { card } = item;
  if (boundCardId !== card.id || local.order.length !== (card.choices?.length ?? 0)) {
    resetLocal(card);
  }

  // Progress is shown against the current chunk, not the whole queue: "3 of 10"
  // is encouraging where "3 of 187" is daunting.
  const intoChunk = app.sessionAnswered % CHECKPOINT_EVERY;
  const chunkSize = Math.min(CHECKPOINT_EVERY, intoChunk + app.remaining);

  root.appendChild(
    el(
      'div',
      { class: 'progressbar' },
      el('div', { style: `width:${(intoChunk / Math.max(chunkSize, 1)) * 100}%` }),
    ),
  );

  root.appendChild(
    el(
      'div',
      { class: 'row small muted', style: 'margin-bottom:.75rem' },
      el('span', {}, `Card ${intoChunk + 1} of ${chunkSize}`),
      el('span', { class: 'spacer' }),
      el('span', {}, item.kind === 'new' ? '✨ New card' : '🔁 Review'),
    ),
  );

  const body = el('div', { class: 'card' });
  body.appendChild(renderTags(card));

  const isChoiceCard = card.type === 'mcq' || card.type === 'scenario';

  if (card.type === 'cloze') {
    body.appendChild(el('div', { class: 'prompt' }, renderCloze(card.prompt, local.revealed)));
  } else {
    body.appendChild(el('div', { class: 'prompt' }, card.prompt));
  }

  if (isChoiceCard && card.choices) {
    body.appendChild(renderChoices(app, card.choices));
  } else if (local.revealed) {
    body.appendChild(el('div', { class: 'answerbox' }, card.answer ?? ''));
  }

  if (local.revealed) {
    // A missed card is framed as learning, not failure — this deck is studied by
    // someone anxious about the exam, and "wrong" answers are the useful ones.
    if (isChoiceCard) {
      const right = isCurrentCorrect(app);
      body.appendChild(
        el(
          'div',
          { class: `verdict ${right ? 'correct' : 'wrong'}` },
          el('span', { class: 'emoji' }, right ? '✅' : '💡'),
          el('span', {}, right ? 'Nice — that’s right.' : 'Not quite — and this is a good one to have caught now.'),
        ),
      );
    }
    body.appendChild(el('div', { class: 'explanation' }, card.explanation));
    body.appendChild(renderRefs(card));
  }

  root.appendChild(body);

  // The action bar is a sticky sibling of the card rather than living inside
  // it, so the rating controls stay on screen however long the explanation
  // runs. Reading the detail may need scrolling; rating never should.
  const actions = el('div', { class: 'actionbar' });
  if (local.revealed) {
    actions.appendChild(renderGrading(app, isChoiceCard));
  } else if (!isChoiceCard) {
    actions.appendChild(
      el('button', { class: 'btn primary', onclick: () => reveal(app) }, 'Show answer'),
    );
  }
  if (actions.childNodes.length > 0) {
    actions.appendChild(renderHints(isChoiceCard));
    root.appendChild(actions);
  } else {
    root.appendChild(renderHints(isChoiceCard));
  }
}

/** The blueprint task in words, trimmed to fit a chip — never the raw code. */
function shortTask(card: Card): string {
  const label = taskLabel(card);
  return label.length > 46 ? `${label.slice(0, 44)}…` : label;
}

function renderTags(card: Card): HTMLElement {
  const domain = domainById(card.domain);
  return el(
    'div',
    { class: 'taglist' },
    el('span', { class: 'tag domain' }, domain ? domain.name : card.domain),
    el('span', { class: 'tag', title: taskLabel(card) }, shortTask(card)),
    ...card.tags.slice(0, 4).map((t) => el('span', { class: 'tag' }, t)),
  );
}

function renderChoices(app: AppState, choices: Choice[]): HTMLElement {
  const list = el('ol', { class: 'choices' });

  local.order.forEach((originalIndex, position) => {
    const choice = choices[originalIndex]!;
    const isSelected = local.selectedIndex === originalIndex;

    let cls = '';
    if (local.revealed) {
      if (choice.correct) cls = 'correct';
      else if (isSelected) cls = 'wrong';
    }

    const button = el(
      'button',
      {
        class: cls,
        disabled: local.revealed,
        onclick: () => selectChoice(app, originalIndex),
      },
      el('span', { class: 'key' }, CHOICE_KEYS[position] ?? String(position + 1)),
      el(
        'span',
        {},
        choice.text,
        local.revealed ? el('span', { class: 'rationale' }, choice.rationale) : null,
      ),
    );

    list.appendChild(el('li', {}, button));
  });

  return list;
}

function renderRefs(card: Card): HTMLElement {
  const refs = resolveRefs(card.refs);
  const missing = card.refs.length - refs.length;

  return el(
    'details',
    { class: 'refs' },
    el(
      'summary',
      {},
      `Where this comes from (${refs.length} source${refs.length === 1 ? '' : 's'})`,
    ),
    el(
      'ul',
      {},
      ...refs.map((r) =>
        el(
          'li',
          {},
          el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.label),
          el('span', { class: 'cite' }, r.citation),
        ),
      ),
      missing > 0 ? el('li', { class: 'muted' }, `${missing} reference(s) could not be resolved`) : null,
    ),
  );
}

function renderGrading(app: AppState, isChoiceCard: boolean): HTMLElement {
  const item = app.current!;
  const preview = previewIntervals(item.progress, app.settings);

  const wrap = el('div', { class: 'grading' });

  for (const { grade, label, key } of GRADE_LABELS) {
    // On an MCQ the outcome already decided Again vs. not; offering "Again"
    // after a correct answer (or Good after a wrong one) would contradict the
    // evidence, so those buttons are hidden rather than shown-and-ignored.
    if (isChoiceCard) {
      const wasCorrect = isCurrentCorrect(app);
      if (wasCorrect && grade === Rating.Again) continue;
      if (!wasCorrect && grade !== Rating.Again) continue;
    }

    wrap.appendChild(
      el(
        'button',
        {
          class: `btn${grade === Rating.Good ? ' primary' : ''}`,
          onclick: () => grade_(app, grade),
        },
        `${label} (${key})`,
        el('span', { class: 'ivl' }, formatInterval(preview[grade])),
      ),
    );
  }

  wrap.appendChild(
    el('button', { class: 'btn', onclick: () => void app.suspendCurrent() }, 'Hide this card (h)'),
  );

  return wrap;
}

function renderHints(isChoiceCard: boolean): HTMLElement {
  return el(
    'div',
    { class: 'kbd-hint' },
    isChoiceCard
      ? frag(
          el('kbd', {}, '1'),
          '–',
          el('kbd', {}, '4'),
          ' answer · ',
        )
      : frag(el('kbd', {}, 'space'), ' reveal · ', el('kbd', {}, '1'), '–', el('kbd', {}, '4'), ' grade · '),
    el('kbd', {}, 'h'),
    ' hide this card',
  );
}

/** Encouragement that reflects how the chunk actually went, without grading the person. */
function chunkMessage(correct: number, total: number): string {
  if (total === 0) return 'Every card you look at is progress.';
  const share = correct / total;
  if (share >= 0.9) return 'That was a strong run. You clearly know this material.';
  if (share >= 0.7) return 'Solid work — most of that was right, and the misses are now flagged to come back.';
  if (share >= 0.4) return 'A mixed set, which is exactly what studying looks like. The ones you missed will come back sooner.';
  return 'That was a tough batch. Getting them wrong now is how they stick later — this is the system working.';
}

/**
 * Shown after each chunk of cards: a breather and an explicit choice about what
 * happens next, rather than an endless queue.
 */
function renderCheckpoint(app: AppState, go: (view: ViewName) => void): HTMLElement {
  const correct = app.sessionCorrect;
  const total = app.sessionAnswered;

  return el(
    'div',
    { class: 'checkpoint' },
    el('div', { class: 'big' }, '🌟'),
    el('h1', {}, `That’s ${total} cards done`),
    el('p', { class: 'encourage' }, chunkMessage(correct, total)),
    el(
      'div',
      { class: 'summary' },
      el('div', {}, el('div', { class: 'n' }, String(total)), el('div', { class: 'l' }, 'cards this session')),
      el('div', {}, el('div', { class: 'n' }, pct(correct, total)), el('div', { class: 'l' }, 'got right')),
      el('div', {}, el('div', { class: 'n' }, String(app.remaining)), el('div', { class: 'l' }, 'still waiting')),
    ),
    el('p', { class: 'muted small' }, 'What would you like to do?'),
    el(
      'div',
      { class: 'actions' },
      el(
        'button',
        { class: 'btn primary', onclick: () => app.acknowledgeCheckpoint() },
        `Keep going (${app.remaining} left)`,
      ),
      el('button', { class: 'btn', onclick: () => go('dashboard') }, 'See how I’m doing'),
      el('button', { class: 'btn', onclick: () => go('home') }, 'Take a break'),
    ),
  );
}

/** Shown when there is genuinely nothing left in the queue. */
function renderComplete(app: AppState, go: (view: ViewName) => void): HTMLElement {
  const counts = app.countsByState();
  const daily = app.repo.getDaily();
  const doneToday = daily.new + daily.review;
  const moreUnseen = counts.new > 0;

  const wrap = el('div', { class: 'checkpoint' });
  wrap.appendChild(el('div', { class: 'big' }, doneToday > 0 ? '🎉' : '☀️'));
  wrap.appendChild(el('h1', {}, doneToday > 0 ? 'All done for now' : 'Nothing due right now'));

  if (app.sessionAnswered > 0) {
    wrap.appendChild(
      el('p', { class: 'encourage' }, chunkMessage(app.sessionCorrect, app.sessionAnswered)),
    );
    wrap.appendChild(
      el(
        'div',
        { class: 'summary' },
        el(
          'div',
          {},
          el('div', { class: 'n' }, String(app.sessionAnswered)),
          el('div', { class: 'l' }, 'cards this session'),
        ),
        el(
          'div',
          {},
          el('div', { class: 'n' }, pct(app.sessionCorrect, app.sessionAnswered)),
          el('div', { class: 'l' }, 'got right'),
        ),
      ),
    );
  } else {
    wrap.appendChild(
      el(
        'p',
        { class: 'encourage' },
        'Your reviews are all up to date. Resting between sessions is part of how spaced repetition works — the gap is doing real work.',
      ),
    );
  }

  if (moreUnseen) {
    wrap.appendChild(
      el(
        'p',
        { class: 'muted small' },
        `${counts.new} card${counts.new === 1 ? '' : 's'} you haven’t seen yet are waiting for future days. ` +
          'If you would like more today, you can raise the daily limit.',
      ),
    );
  }

  if (app.cards.length === 0) {
    wrap.appendChild(el('p', { class: 'muted small' }, 'No cards are loaded yet.'));
  }

  wrap.appendChild(
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'btn primary', onclick: () => go('dashboard') }, 'See how I’m doing'),
      moreUnseen
        ? el('button', { class: 'btn', onclick: () => go('settings') }, 'Study more today')
        : null,
      el('button', { class: 'btn', onclick: () => go('home') }, 'Back to start'),
    ),
  );

  return wrap;
}

// ---- interactions ----------------------------------------------------------

function isCurrentCorrect(app: AppState): boolean {
  const choices = app.current?.card.choices;
  if (!choices || local.selectedIndex === null) return false;
  return choices[local.selectedIndex]?.correct ?? false;
}

function selectChoice(app: AppState, index: number): void {
  if (local.revealed) return;
  local.selectedIndex = index;
  local.revealed = true;
  app.onChange();
}

function reveal(app: AppState): void {
  if (local.revealed) return;
  local.revealed = true;
  app.onChange();
}

function grade_(app: AppState, grade: Grade): void {
  const item = app.current;
  if (!item || !local.revealed) return;

  const isChoiceCard = item.card.type === 'mcq' || item.card.type === 'scenario';
  const correct = isChoiceCard ? isCurrentCorrect(app) : undefined;
  const elapsed = Date.now() - local.shownAt;

  boundCardId = null; // force local reset for the next card
  void app.answerCurrent(grade, correct, elapsed);
}

/** Global key handling for the study view. Returns true if the key was used. */
export function handleReviewKey(app: AppState, event: KeyboardEvent): boolean {
  const item = app.current;
  if (!item) return false;

  const key = event.key.toLowerCase();
  const isChoiceCard = item.card.type === 'mcq' || item.card.type === 'scenario';

  if (key === 'h' || key === 's') {
    void app.suspendCurrent();
    return true;
  }

  if (!local.revealed) {
    if (isChoiceCard) {
      const index = CHOICE_KEYS.indexOf(key);
      const position = index >= 0 ? index : 'abcde'.indexOf(key);
      if (position >= 0 && position < local.order.length) {
        selectChoice(app, local.order[position]!);
        return true;
      }
    } else if (key === ' ' || key === 'enter') {
      reveal(app);
      return true;
    }
    return false;
  }

  // Revealed: number keys grade.
  const gradeEntry = GRADE_LABELS.find((g) => g.key === key);
  if (gradeEntry) {
    if (isChoiceCard) {
      // Only the rating consistent with the recorded outcome is accepted.
      const wasCorrect = isCurrentCorrect(app);
      if (wasCorrect && gradeEntry.grade === Rating.Again) return false;
      if (!wasCorrect && gradeEntry.grade !== Rating.Again) return false;
    }
    grade_(app, gradeEntry.grade);
    return true;
  }

  if (key === ' ' || key === 'enter') {
    // Space after reveal = the default "Good"/"Again" path.
    const isChoice = isChoiceCard;
    grade_(app, isChoice && !isCurrentCorrect(app) ? (Rating.Again as Grade) : (Rating.Good as Grade));
    return true;
  }

  return false;
}

/** Lets the shell reset per-card state when the view is re-entered. */
export function resetReviewView(): void {
  boundCardId = null;
}
