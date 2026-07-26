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
import { RAMP_WINDOW_DAYS } from '../scheduler/examDate';

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
  const update = async (patch: Parameters<typeof app.repo.updateSettings>[0]) => {
    await app.repo.updateSettings(patch);
    app.rebuildQueue();
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
        onchange: (e: Event) => void update({ examDate: (e.target as HTMLInputElement).value || null }),
      }),
      'Optional, but helpful — we’ll count down to it and make sure every card comes back ' +
        'around at least once before the day itself.',
    ),
  );

  scheduling.appendChild(
    field(
      `How well do you want to remember things? — ${Math.round(s.desiredRetention * 100)}%`,
      el('input', {
        type: 'range',
        min: '0.75',
        max: '0.98',
        step: '0.01',
        value: String(s.desiredRetention),
        onchange: (e: Event) => void update({ desiredRetention: Number((e.target as HTMLInputElement).value) }),
      }),
      'Aim higher and cards come back more often, so you forget less but study more. ' +
        'Around 90% is a good balance for most people — there’s no wrong answer here.',
    ),
  );

  scheduling.appendChild(
    check(
      'Study a little harder as the exam gets closer',
      s.rampRetention,
      (v) => void update({ rampRetention: v }),
      `In the final ${RAMP_WINDOW_DAYS} days we’ll bring cards back a bit more often, so things ` +
        'are fresh when it actually counts.',
    ),
  );

  scheduling.appendChild(
    check(
      'Make sure everything comes up before exam day',
      s.capIntervalsAtExam,
      (v) => void update({ capIntervalsAtExam: v }),
      'Cards you know well can otherwise drift months into the future and never reappear ' +
        'before your exam. This pulls them back so nothing is forgotten at the wrong moment.',
    ),
  );

  scheduling.appendChild(
    check(
      'Mix up the topics while you study',
      s.interleave,
      (v) => void update({ interleave: v }),
      'Jumping between subjects feels harder than doing one at a time — and that’s exactly ' +
        'why it works better. Worth leaving on unless you want to drill one area.',
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
        onchange: (e: Event) => void update({ maxNewPerDay: Number((e.target as HTMLInputElement).value) }),
      }),
      'How much brand-new material to introduce. Start smaller than you think — every new ' +
        'card comes back for review later, so these add up.',
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
        onchange: (e: Event) => void update({ maxReviewsPerDay: Number((e.target as HTMLInputElement).value) }),
      }),
      'A safety net. If you miss a few days, this stops everything landing on you at once.',
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
        : '⚠️ Your progress is not being saved right now — it will disappear when you close this tab. ' +
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
      `There are ${app.cards.length} cards here, and they’re spread across the exam’s topics in ` +
        'the same proportions the real test uses — so the areas worth the most marks get the ' +
        'most practice.',
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
      'Heads up: the exam changes on 1 July 2027 — fewer questions, three answers instead of ' +
        'four, and reorganised topics. These cards are written for the current version, so if ' +
        'you’re testing on or after that date they won’t match.',
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
      'These are practice questions written from the official published outline — not real exam ' +
        'questions, and not connected to or endorsed by NBCC. Every answer links to a source you ' +
        'can check for yourself.',
    ),
  );
  root.appendChild(about);
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el(
    'div',
    { class: 'field' },
    el('label', {}, label),
    control,
    hint ? el('div', { class: 'hint' }, hint) : null,
  );
}

function check(
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
  hint?: string,
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
    ),
    hint ? el('div', { class: 'hint', style: 'margin-left:1.5rem;margin-top:-.5rem' }, hint) : null,
  );
}
