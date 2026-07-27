/**
 * Settings, plus the backup controls that make non-durable storage survivable.
 *
 * Copy rule for this screen: describe what the setting does *for the user*, never
 * how it works internally. No "retention", "intervals", "domains", "IndexedDB",
 * "FSRS" — those are implementation words and they make an anxious person feel
 * they need to understand a system before they can study.
 */
import type { AppState } from '../app';
import { blueprint } from '../data/loader';
import { el, clear } from './dom';
import { downloadBackup, parseBackup, BackupParseError } from '../storage/backup';
import { RAMP_WINDOW_DAYS, requiredNewPerDay, daysUntilExam } from '../scheduler/examDate';
import { State } from 'ts-fsrs';

/** Surfaced after an exam-date change so the reshuffle isn't invisible. */
let lastReschedule = 0;

/**
 * Which setting was saved most recently, so the confirmation can sit beside
 * that field rather than in a corner. Settings save the instant you change
 * them, with no Save button to press, so without this nothing on screen tells
 * you it worked — and "did that take?" is a bad question to leave with someone
 * already anxious.
 *
 * Module-level because changing a setting re-renders the whole view, so a
 * confirmation held in local state would be destroyed by the very act that
 * created it.
 */
let savedKey: string | null = null;
let savedTimer: ReturnType<typeof setTimeout> | undefined;

/** Long enough to notice without becoming a permanent fixture. */
const SAVED_VISIBLE_MS = 2600;

/**
 * How many new cards a day a just-changed exam date actually calls for, when
 * that is more than the current setting allows. Null the rest of the time.
 *
 * Only the "not enough" direction is worth raising. The pacing figure is a
 * *floor* — the minimum needed to see every card once before the exam — not an
 * optimum, so telling someone with a distant exam to drop to 1 card a day would
 * be bad advice dressed up as a recommendation.
 */
let pacingSuggestion: number | null = null;

/** Test seam: clears the confirmation between cases. */
export function resetSettingsView(): void {
  lastReschedule = 0;
  savedKey = null;
  pacingSuggestion = null;
  clearTimeout(savedTimer);
  savedTimer = undefined;
}

function markSaved(key: string, app: AppState): void {
  savedKey = key;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedKey = null;
    // Not while the pacing prompt is up: re-rendering rebuilds the view from
    // scratch, which would tear down the open modal and pop a fresh one in its
    // place — a visible blink, and the focus inside it lost. Dismissing the
    // prompt re-renders anyway, which clears the chip then.
    if (pacingSuggestion !== null) return;
    // Re-render through the app so this is a no-op if the user has navigated
    // away, rather than writing into a detached element.
    app.onChange();
  }, SAVED_VISIBLE_MS);
}

/** The confirmation itself — quiet, and never in the way of the control. */
function savedChip(): HTMLElement {
  return el('span', { class: 'saved-chip' }, '✓ Saved');
}

export function renderSettings(app: AppState, root: HTMLElement): void {
  clear(root);
  root.appendChild(el('h1', {}, 'Settings'));
  root.appendChild(
    el(
      'p',
      { class: 'lede' },
      'Everything here has a sensible default. You can happily ignore this page.',
    ),
  );

  const s = app.settings;
  const rerender = () => renderSettings(app, root);
  const update = async (key: string, patch: Parameters<typeof app.repo.updateSettings>[0]) => {
    const { rescheduled } = await app.updateSettings(patch);
    lastReschedule = rescheduled;
    if (key === 'examDate') pacingSuggestion = suggestNewPerDay(app);
    markSaved(key, app);
    rerender();
  };

  // ---- exam date and pacing ----
  const scheduling = el('div', { class: 'card' });
  scheduling.appendChild(el('h2', { style: 'margin-top:0' }, 'Your exam'));

  scheduling.appendChild(
    field(
      'When is your exam?',
      el('input', {
        type: 'date',
        value: s.examDate ?? '',
        onchange: (e: Event) =>
          void update('examDate', { examDate: (e.target as HTMLInputElement).value || null }),
      }),
      'Optional, but helpful. We’ll count down to it and make sure every card comes back ' +
        'around at least once before the day itself.',
      'examDate',
    ),
  );

  if (lastReschedule > 0) {
    scheduling.appendChild(
      el(
        'p',
        { class: 'small', style: 'color:var(--accent-strong);margin:-.6rem 0 1rem' },
        `✅ Moved ${lastReschedule} card${lastReschedule === 1 ? '' : 's'} so they come up before your exam.`,
      ),
    );
  }

  scheduling.appendChild(
    field(
      `How well do you want to remember things? ${Math.round(s.desiredRetention * 100)}%`,
      el('input', {
        type: 'range',
        min: '0.75',
        max: '0.98',
        step: '0.01',
        value: String(s.desiredRetention),
        onchange: (e: Event) =>
          void update('desiredRetention', {
            desiredRetention: Number((e.target as HTMLInputElement).value),
          }),
      }),
      'Aim higher and cards come back more often, so you forget less but study more. ' +
        'Around 90% suits most people.',
      'desiredRetention',
    ),
  );

  scheduling.appendChild(
    check(
      'Study a little harder as the exam gets closer',
      s.rampRetention,
      (v) => void update('rampRetention', { rampRetention: v }),
      `In the final ${RAMP_WINDOW_DAYS} days we’ll bring cards back a bit more often, so things ` +
        'are fresh when it actually counts.',
      'rampRetention',
    ),
  );

  scheduling.appendChild(
    check(
      'Make sure everything comes up before exam day',
      s.capIntervalsAtExam,
      (v) => void update('capIntervalsAtExam', { capIntervalsAtExam: v }),
      'Cards you know well can otherwise drift months into the future and never reappear ' +
        'before your exam. This pulls them back so nothing is forgotten at the wrong moment.',
      'capIntervalsAtExam',
    ),
  );

  scheduling.appendChild(
    check(
      'Mix up the topics while you study',
      s.interleave,
      (v) => void update('interleave', { interleave: v }),
      'Jumping between subjects feels harder than doing one at a time, and that’s exactly ' +
        'why it works better. Worth leaving on unless you want to drill one area.',
      'interleave',
    ),
  );

  root.appendChild(scheduling);

  // ---- daily limits ----
  const limits = el('div', { class: 'card' });
  limits.appendChild(el('h2', { style: 'margin-top:0' }, 'How much to study each day'));
  limits.appendChild(
    field(
      'New cards a day',
      el('input', {
        type: 'number',
        min: '0',
        max: '500',
        value: String(s.maxNewPerDay),
        onchange: (e: Event) =>
          void update('maxNewPerDay', { maxNewPerDay: Number((e.target as HTMLInputElement).value) }),
      }),
      'How much brand-new material to introduce. Start smaller than you think: every new ' +
        'card comes back for review later, so these add up.',
      'maxNewPerDay',
    ),
  );
  limits.appendChild(
    field(
      'Most cards to review in a day',
      el('input', {
        type: 'number',
        min: '0',
        max: '2000',
        value: String(s.maxReviewsPerDay),
        onchange: (e: Event) =>
          void update('maxReviewsPerDay', {
            maxReviewsPerDay: Number((e.target as HTMLInputElement).value),
          }),
      }),
      'A safety net. If you miss a few days, this stops everything landing on you at once.',
      'maxReviewsPerDay',
    ),
  );
  root.appendChild(limits);

  // ---- backup ----
  const backup = el('div', { class: 'card' });
  backup.appendChild(el('h2', { style: 'margin-top:0' }, 'Keeping your progress safe'));

  const saving = app.repo.tier !== 'memory';
  backup.appendChild(
    el(
      'p',
      { class: 'small', style: saving ? '' : 'color:var(--wrong);font-weight:600' },
      saving
        ? '✅ Your progress is being saved on this device.'
        : '⚠️ Your progress is not being saved right now. It will disappear when you close this tab. ' +
            'Save a copy below before you go.',
    ),
  );
  backup.appendChild(
    el(
      'p',
      { class: 'small muted' },
      'Saving a copy gives you a file with everything you’ve studied so far. You can load it ' +
        'back here later, or use it to carry your progress to another device.',
    ),
  );

  const status = el('p', { class: 'small' });

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
    onchange: (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void file
        .text()
        .then(async (text) => {
          const parsed = parseBackup(text);
          await app.repo.replaceAll(parsed);
          app.repo.ensureCards(app.cards.map((c) => c.id));
          await app.repo.persist();
          app.rebuildQueue();
          rerender();
        })
        .catch((err: unknown) => {
          status.textContent =
            err instanceof BackupParseError
              ? `That file couldn’t be loaded. ${err.message}`
              : 'That file couldn’t be loaded.';
          status.style.color = 'var(--wrong)';
        });
    },
  });

  backup.appendChild(
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn primary', onclick: () => downloadBackup(app.repo) }, 'Save a copy'),
      el('button', { class: 'btn', onclick: () => fileInput.click() }, 'Load a saved copy'),
      fileInput,
    ),
  );
  backup.appendChild(status);
  root.appendChild(backup);

  // ---- reset ----
  const danger = el('div', { class: 'card' });
  danger.appendChild(el('h2', { style: 'margin-top:0' }, 'Starting over'));
  danger.appendChild(
    el(
      'p',
      { class: 'small muted' },
      'This puts every card back to “not started” and forgets everything you’ve done so far. ' +
        'There’s no undo, so save a copy first if you might want it back.',
    ),
  );

  let armed = false;
  const resetBtn = el('button', { class: 'btn' }, 'Erase my progress');
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      resetBtn.textContent = 'Are you sure? Click again';
      resetBtn.style.borderColor = 'var(--wrong)';
      resetBtn.style.color = 'var(--wrong)';
      return;
    }
    void app.repo.resetAll().then(async () => {
      app.repo.ensureCards(app.cards.map((c) => c.id));
      await app.repo.persist();
      app.rebuildQueue();
      rerender();
    });
  });
  danger.appendChild(resetBtn);
  root.appendChild(danger);

  // ---- about ----
  const about = el('div', { class: 'card' });
  about.appendChild(el('h2', { style: 'margin-top:0' }, 'About these cards'));
  about.appendChild(
    el(
      'p',
      { class: 'small' },
      `There are ${app.cards.length} cards here, spread across the exam’s topics in the same ` +
        'proportions the real test uses, so the areas worth the most marks get the most practice.',
    ),
  );
  about.appendChild(
    el(
      'p',
      { class: 'small muted' },
      `The exam itself is ${blueprint.exam.totalItems} questions with ` +
        `${blueprint.exam.optionsPerItem} answers each, and you get ` +
        `${Math.floor(blueprint.exam.timeLimitMinutes / 60)} hours ` +
        `${blueprint.exam.timeLimitMinutes % 60} minutes, plus a 15-minute break halfway through.`,
    ),
  );
  about.appendChild(
    el(
      'p',
      { class: 'small muted' },
      'Heads up: the exam changes on 1 July 2027, with fewer questions, three answers instead ' +
        'of four, and reorganised topics. These cards are written for the current version, so ' +
        'if you’re testing on or after that date they won’t match.',
    ),
  );
  about.appendChild(
    el(
      'p',
      { class: 'small' },
      el('a', { href: 'https://nbcc.org/exams/nce', target: '_blank', rel: 'noopener noreferrer' }, 'Official NCE page'),
      ' · ',
      el(
        'a',
        { href: 'https://nbcc.org/assets/exam/nce_content_outline.pdf', target: '_blank', rel: 'noopener noreferrer' },
        'What the exam covers (PDF)',
      ),
    ),
  );
  about.appendChild(
    el(
      'p',
      { class: 'small muted' },
      'These are practice questions written from the official published outline. They are not ' +
        'real exam questions, and this app is not connected to or endorsed by NBCC. Every answer ' +
        'links to a source you can check for yourself.',
    ),
  );
  root.appendChild(about);

  if (pacingSuggestion !== null) {
    const dialog = pacingDialog(app, pacingSuggestion, rerender);
    root.appendChild(dialog);
    // Guarded twice over: jsdom has no <dialog> implementation at all, and
    // showModal() throws InvalidStateError on an element that is not in the
    // document — which once blanked the whole page from inside a re-render.
    if (typeof dialog.showModal === 'function' && dialog.isConnected) dialog.showModal();
  }
}

/**
 * The daily new-card number this exam date needs, or null if the current
 * setting already covers it (or there is nothing useful to say).
 */
export function suggestNewPerDay(app: AppState, now: Date = new Date()): number | null {
  const unseen = app.cards.reduce((n, card) => {
    const p = app.progressFor(card.id);
    return n + (!p || p.suspended || p.state === State.New ? 1 : 0);
  }, 0);

  const needed = requiredNewPerDay(unseen, app.settings.examDate, now);
  // Infinity means the date is today or already past — a pacing number cannot
  // help with that, and offering one would be a lie.
  if (needed === null || !Number.isFinite(needed) || needed <= 0) return null;
  return needed > app.settings.maxNewPerDay ? needed : null;
}

/**
 * Shown when the exam date changes and the current daily limit will not get
 * through the deck in time. Does the arithmetic and offers the answer as a
 * button, rather than reporting a number and leaving the user to find the
 * right field — which is exactly the kind of homework this app should absorb.
 */
function pacingDialog(app: AppState, suggestion: number, done: () => void): HTMLDialogElement {
  const dialog = el('dialog', { class: 'pacing' }) as HTMLDialogElement;
  // No dialog.close() needed: clearing the suggestion and re-rendering removes
  // the element outright, which takes it out of the top layer too.
  const close = () => {
    pacingSuggestion = null;
    done();
  };

  const days = daysUntilExam(app.settings.examDate);
  dialog.appendChild(el('h2', {}, 'Shall we pick up the pace?'));
  dialog.appendChild(
    el(
      'p',
      {},
      days === null
        ? ''
        : `Your exam is ${days} day${days === 1 ? '' : 's'} away. `,
      'To see every card at least once before then, you’d need about ',
      el('strong', {}, `${suggestion} new cards a day`),
      `. You’re set to ${app.settings.maxNewPerDay}.`,
    ),
  );
  dialog.appendChild(
    el(
      'p',
      { class: 'small muted' },
      'You can change this any time. Going steadier costs nothing except seeing fewer of the ' +
        'cards before the day itself.',
    ),
  );
  dialog.appendChild(
    el(
      'div',
      { class: 'row' },
      el(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            void app.updateSettings({ maxNewPerDay: suggestion }).then(() => {
              // Confirm on the field that actually changed, so the effect of
              // the button is visible on the page behind the dialog.
              markSaved('maxNewPerDay', app);
              close();
            });
          },
        },
        `Use ${suggestion} a day`,
      ),
      el(
        'button',
        { class: 'btn ghost', onclick: close },
        `Keep ${app.settings.maxNewPerDay}`,
      ),
    ),
  );

  // Escape dismisses rather than leaving the dialog stuck open on a re-render.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  return dialog;
}

function field(label: string, control: HTMLElement, hint: string, key: string): HTMLElement {
  return el(
    'div',
    { class: 'field' },
    el('label', {}, label, savedKey === key ? savedChip() : null),
    control,
    hint ? el('div', { class: 'hint' }, hint) : null,
  );
}

function check(
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
  hint: string,
  key: string,
): HTMLElement {
  const id = `chk-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return el(
    'div',
    { style: 'margin-bottom:1rem' },
    el(
      'div',
      { class: 'checkline' },
      el('input', {
        type: 'checkbox',
        id,
        checked: value,
        onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
      }),
      el('label', { for: id, style: 'font-weight:650;font-size:.92rem' }, label),
      savedKey === key ? savedChip() : null,
    ),
    hint ? el('div', { class: 'hint', style: 'margin-left:1.5rem;margin-top:-.5rem' }, hint) : null,
  );
}
