/**
 * "My Progress".
 *
 * Three rules this screen is built around, learned from the version before it:
 *
 * 1. **One headline, and it must move on day one.** The old headline was
 *    "feeling solid", defined as FSRS stability past a 21-day horizon — which
 *    nothing can reach in early sessions, so it read 0% after a genuinely good
 *    run of 14 cards. A number that cannot move is worse than no number,
 *    especially for someone anxious about this exam.
 * 2. **Name states in the words the rating buttons already use.** The user rates
 *    Again / Hard / Good / Easy; "sticking" appeared nowhere in that vocabulary
 *    and so meant nothing. States are Solid / Learning / Not started, and
 *    "Solid" has a behavioural definition — the card graduated out of learning
 *    because it was rated well enough, which starts happening in session one.
 * 3. **Bars decompose the headline.** Every bar is the same three-colour stack,
 *    so a row reads as "this is what the headline is made of" rather than
 *    duplicating the share-of-exam column, which is what the old bars did.
 *
 * Both coverage axes still matter — the six NBCC domains are work behaviours,
 * and subjects like career theory are spread across them — but they are now one
 * table behind a switcher rather than two near-identical tables.
 */
import type { AppState } from '../app';
import { blueprint } from '../data/loader';
import { el, clear, pct } from './dom';
import { State } from '../scheduler/fsrs';
import { daysUntilExam, requiredNewPerDay } from '../scheduler/examDate';
import type { CacrepArea, Card } from '../data/schema';

/** Which breakdown the table is showing. Module-level so it survives re-render. */
let axis: 'topic' | 'subject' = 'topic';

/** Test seam — the tab choice is deliberately sticky for users, not for tests. */
export function resetDashboardView(): void {
  axis = 'topic';
}

export interface Breakdown {
  solid: number;
  learning: number;
  notStarted: number;
  total: number;
}

/**
 * Split cards into the three states used everywhere on this page. "Solid" is the
 * FSRS Review state: the card graduated out of learning. That reflects something
 * the user actually did, and it is reachable immediately.
 */
export function breakdown(app: AppState, cards: Card[]): Breakdown {
  let solid = 0;
  let learning = 0;
  let notStarted = 0;

  for (const card of cards) {
    const p = app.progressFor(card.id);
    if (!p || p.suspended || p.state === State.New) notStarted++;
    else if (p.state === State.Review) solid++;
    else learning++;
  }
  return { solid, learning, notStarted, total: cards.length };
}

/** The stacked bar that every row and the headline share. */
function stackedBar(b: Breakdown): HTMLElement {
  const share = (n: number) => (b.total > 0 ? (n / b.total) * 100 : 0);
  return el(
    'div',
    {
      class: 'stack',
      title: `${b.solid} solid · ${b.learning} still learning · ${b.notStarted} not started`,
    },
    el('div', { class: 'seg solid', style: `width:${share(b.solid)}%` }),
    el('div', { class: 'seg learning', style: `width:${share(b.learning)}%` }),
  );
}

export function renderDashboard(app: AppState, root: HTMLElement): void {
  clear(root);
  const rerender = () => renderDashboard(app, root);

  root.appendChild(el('h1', {}, 'How you’re doing'));
  root.appendChild(
    el(
      'p',
      { class: 'lede' },
      'A snapshot, not a verdict. Gaps here are just the parts you haven’t got to yet.',
    ),
  );

  const all = breakdown(app, app.cards);
  const started = all.solid + all.learning;
  const startedPct = all.total > 0 ? Math.round((started / all.total) * 100) : 0;
  const days = daysUntilExam(app.settings.examDate);
  const recent = app.recentAccuracy(100);
  const daily = app.repo.getDaily();

  // ---- headline ----------------------------------------------------------
  // The big number is a *count*, not a percentage: with 512 cards a percentage
  // still rounds to 0% after the first two answers, which is the very problem
  // this rewrite exists to fix. A count moves on card one and is honest.
  const headline = el('div', { class: 'headline' });
  headline.appendChild(el('div', { class: 'big' }, String(started)));
  headline.appendChild(
    el(
      'div',
      { class: 'label' },
      started === 1
        ? `card worked through — that’s ${startedPct}% of the deck`
        : `cards worked through — that’s ${startedPct}% of the deck`,
    ),
  );
  headline.appendChild(stackedBar(all));
  headline.appendChild(
    el(
      'div',
      { class: 'legend' },
      legendItem('solid', all.solid, 'solid'),
      legendItem('learning', all.learning, 'still learning'),
      legendItem('rest', all.notStarted, 'not started yet'),
    ),
  );
  root.appendChild(headline);

  // ---- secondary stats, deliberately subordinate --------------------------
  const stats = el('div', { class: 'substats' });
  stats.appendChild(
    substat(
      recent.total > 0 ? pct(recent.correct, recent.total) : '—',
      recent.total > 0 ? `right, last ${recent.total} answer${recent.total === 1 ? '' : 's'}` : 'no answers yet',
    ),
  );
  stats.appendChild(substat(String(daily.new + daily.review), 'done today'));
  if (days !== null) {
    stats.appendChild(
      substat(
        days > 0 ? String(days) : days === 0 ? 'today' : 'past',
        days > 0 ? `day${days === 1 ? '' : 's'} until your exam` : 'your exam date',
      ),
    );
  }
  root.appendChild(stats);

  // ---- pacing -------------------------------------------------------------
  if (days !== null && days > 0) {
    const needed = requiredNewPerDay(all.notStarted, app.settings.examDate);
    if (needed !== null && needed !== Infinity && needed > 0) {
      root.appendChild(
        el(
          'p',
          { class: 'small muted' },
          `To get through everything in time, aim for about ${needed} new card${needed === 1 ? '' : 's'} a day ` +
            `(you’re set to ${app.settings.maxNewPerDay}).` +
            (needed > app.settings.maxNewPerDay ? ' That’s more than your current setting allows.' : ''),
        ),
      );
    } else if (needed === 0) {
      root.appendChild(
        el('p', { class: 'small muted' }, 'You’ve started every card at least once. Nice.'),
      );
    }
  }

  // ---- one table, two views ----------------------------------------------
  root.appendChild(el('h2', {}, 'Where your time has gone'));

  const tabs = el('div', { class: 'switch' });
  for (const [id, label] of [
    ['topic', 'By exam topic'],
    ['subject', 'By subject area'],
  ] as Array<['topic' | 'subject', string]>) {
    tabs.appendChild(
      el(
        'button',
        {
          'aria-pressed': axis === id ? 'true' : 'false',
          onclick: () => {
            axis = id;
            rerender();
          },
        },
        label,
      ),
    );
  }
  root.appendChild(tabs);
  root.appendChild(
    el(
      'p',
      { class: 'small muted', style: 'margin-top:-.35rem' },
      axis === 'topic'
        ? 'The same three colours as above, split by the exam’s own topics.'
        : 'The same cards sliced another way — a topic can look fine while a subject inside it is thin.',
    ),
  );

  const rows: Array<{ name: string; note?: string; cards: Card[] }> =
    axis === 'topic'
      ? blueprint.domains.map((d) => ({
          name: d.name,
          note: `${d.weight}% of the exam`,
          cards: app.cards.filter((c) => c.domain === d.id),
        }))
      : blueprint.cacrepAreas.map((a) => ({
          name: a.name,
          cards: app.cards.filter((c) => c.cacrep.includes(a.id as CacrepArea)),
        }));

  const table = el(
    'table',
    { class: 'grid' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, axis === 'topic' ? 'Topic' : 'Subject'),
        el('th', { class: 'num' }, 'Worked through'),
        el('th', {}, 'Breakdown'),
      ),
    ),
  );

  const tbody = el('tbody');
  for (const row of rows) {
    const b = breakdown(app, row.cards);
    const done = b.solid + b.learning;
    tbody.appendChild(
      el(
        'tr',
        {},
        el(
          'td',
          {},
          el('div', {}, row.name),
          row.note ? el('div', { class: 'rownote' }, row.note) : null,
        ),
        el(
          'td',
          { class: 'num' },
          b.total > 0 ? `${Math.round((done / b.total) * 100)}%` : '—',
          el('div', { class: 'rownote' }, `${done} of ${b.total}`),
        ),
        el('td', { class: 'barcell' }, stackedBar(b)),
      ),
    );
  }
  table.appendChild(tbody);
  root.appendChild(el('div', { class: 'tablewrap' }, table));

  // ---- forecast, only when it has something to say ------------------------
  const forecast = app.dueForecast(14);
  if (forecast.some((n) => n > 0)) {
    root.appendChild(el('h2', {}, 'What’s coming up'));
    // Trim the empty tail rather than showing thirteen blank slots.
    const lastDay = forecast.reduce((last, n, i) => (n > 0 ? i : last), 0);
    const shown = forecast.slice(0, Math.max(7, lastDay + 1));
    const max = Math.max(1, ...shown);
    const bars = el('div', { class: 'forecast' });
    shown.forEach((n, i) => {
      bars.appendChild(
        el(
          'div',
          { class: 'fbar', title: `${n} card${n === 1 ? '' : 's'} due` },
          el('div', {
            class: 'fill',
            style: `height:${(n / max) * 100}%;min-height:${n > 0 ? 3 : 0}px`,
          }),
          el('span', {}, i === 0 ? 'today' : i === 1 ? 'tmrw' : `+${i}`),
        ),
      );
    });
    root.appendChild(el('div', { class: 'card' }, bars));
  }
}

function legendItem(cls: string, n: number, label: string): HTMLElement {
  return el(
    'span',
    { class: 'legend-item' },
    el('i', { class: `swatch ${cls}` }),
    el('strong', {}, String(n)),
    ` ${label}`,
  );
}

function substat(value: string, label: string): HTMLElement {
  return el('div', { class: 'substat' }, el('div', { class: 'n' }, value), el('div', { class: 'l' }, label));
}
