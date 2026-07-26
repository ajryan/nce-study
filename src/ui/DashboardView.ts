/**
 * Readiness dashboard.
 *
 * Reports coverage on both axes that matter. The NBCC domain table answers
 * "am I studying in proportion to the exam?"; the CACREP table answers "am I
 * neglecting a whole subject?" — which the domain table alone cannot show,
 * because the six domains are work behaviours and subjects like career theory
 * and research methods are spread across them.
 */
import type { AppState } from '../app';
import { blueprint } from '../data/loader';
import { el, clear, pct } from './dom';
import { State } from '../scheduler/fsrs';
import { daysUntilExam, readinessPct, requiredNewPerDay } from '../scheduler/examDate';
import type { CacrepArea } from '../data/schema';

export function renderDashboard(app: AppState, root: HTMLElement): void {
  clear(root);
  root.appendChild(el('h1', {}, 'How you’re doing'));
  root.appendChild(
    el(
      'p',
      { class: 'lede' },
      'A snapshot, not a verdict. Gaps here are just the parts you haven’t got to yet.',
    ),
  );

  const counts = app.countsByState();
  const total = app.cards.length;
  const settings = app.settings;
  const days = daysUntilExam(settings.examDate);

  // Horizon for "strong": stability must carry the card to the exam, or 21
  // days out when no exam date is set.
  const horizon = days !== null && days > 0 ? days : 21;
  const strong = app.strongCount(horizon);
  const readiness = readinessPct({ totalCards: total, strongCards: strong, seenCards: total - counts.new });

  const recent = app.recentAccuracy(100);
  const lifetime = app.accuracy();

  // ---- headline stats ----
  const stats = el('div', { class: 'stats' });
  stats.appendChild(stat(`${readiness}%`, 'Feeling solid'));
  stats.appendChild(stat(String(counts.new), 'Not started yet'));
  stats.appendChild(stat(String(counts.learning), 'Still learning'));
  stats.appendChild(stat(String(counts.review), 'Sticking well'));
  stats.appendChild(
    stat(recent.total > 0 ? pct(recent.correct, recent.total) : '—', `Recent answers right`),
  );
  stats.appendChild(
    stat(lifetime.total > 0 ? pct(lifetime.correct, lifetime.total) : '—', 'All-time answers right'),
  );
  root.appendChild(stats);

  // ---- exam countdown ----
  if (days !== null) {
    const needed = requiredNewPerDay(counts.new, settings.examDate);
    root.appendChild(
      el(
        'div',
        { class: 'card' },
        el('strong', {}, days > 0 ? `${days} day${days === 1 ? '' : 's'} until the exam` : days === 0 ? 'Exam is today' : `Exam was ${-days} day(s) ago`),
        needed !== null && needed !== Infinity && needed > 0
          ? el(
              'p',
              { class: 'small muted', style: 'margin:.4rem 0 0' },
              `To see every remaining card at least once, introduce ${needed} new card${needed === 1 ? '' : 's'} per day ` +
                `(your current limit is ${settings.maxNewPerDay}).` +
                (needed > settings.maxNewPerDay ? ' Your limit is too low to finish in time.' : ''),
            )
          : needed === Infinity
            ? el('p', { class: 'small muted', style: 'margin:.4rem 0 0' }, `${counts.new} card(s) remain unseen.`)
            : el('p', { class: 'small muted', style: 'margin:.4rem 0 0' }, 'Every card has been seen at least once.'),
      ),
    );
  }

  // ---- domain coverage ----
  root.appendChild(el('h2', {}, 'Your progress by exam topic'));
  root.appendChild(
    el('p', { class: 'small muted', style: 'margin-top:-.3rem' },
      'The bar shows how much of each topic is sticking. The small marker is how heavily that topic is tested.'),
  );

  const domainTable = el(
    'table',
    { class: 'grid' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Domain'),
        el('th', { class: 'num' }, 'Cards'),
        el('th', { class: 'num' }, 'Mastered'),
        el('th', { class: 'num' }, 'Exam wt.'),
        el('th', {}, 'Coverage'),
      ),
    ),
  );

  const tbody = el('tbody');
  for (const domain of blueprint.domains) {
    const domainCards = app.cards.filter((c) => c.domain === domain.id);
    const mastered = domainCards.filter((c) => {
      const p = app.progressFor(c.id);
      return p && !p.suspended && p.state === State.Review && p.stability >= horizon;
    }).length;
    const share = domainCards.length / Math.max(total, 1);

    tbody.appendChild(
      el(
        'tr',
        {},
        el('td', {}, `${domain.id} · ${domain.name}`),
        el('td', { class: 'num' }, String(domainCards.length)),
        el('td', { class: 'num' }, `${mastered}/${domainCards.length}`),
        el('td', { class: 'num' }, `${domain.weight}%`),
        el(
          'td',
          {},
          el(
            'div',
            { class: 'meter', title: `${Math.round(share * 100)}% of deck vs ${domain.weight}% of exam` },
            el('div', {
              class: 'fill',
              style: `width:${domainCards.length ? (mastered / domainCards.length) * 100 : 0}%`,
            }),
            el('div', { class: 'target', style: `left:${domain.weight * 2}%` }),
          ),
        ),
      ),
    );
  }
  domainTable.appendChild(tbody);
  root.appendChild(el('div', { class: 'tablewrap' }, domainTable));

  // ---- CACREP coverage ----
  root.appendChild(el('h2', {}, 'Your progress by subject area'));
  root.appendChild(
    el('p', { class: 'small muted', style: 'margin-top:-.3rem' },
      'A second way of slicing the same cards — a topic can look fine while a subject inside it is thin.'),
  );

  const cacrepTable = el(
    'table',
    { class: 'grid' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Core area'), el('th', { class: 'num' }, 'Cards'), el('th', { class: 'num' }, 'Mastered'), el('th', {}, ''))),
  );
  const cbody = el('tbody');
  for (const area of blueprint.cacrepAreas) {
    const areaCards = app.cards.filter((c) => c.cacrep.includes(area.id as CacrepArea));
    const mastered = areaCards.filter((c) => {
      const p = app.progressFor(c.id);
      return p && !p.suspended && p.state === State.Review && p.stability >= horizon;
    }).length;

    cbody.appendChild(
      el(
        'tr',
        {},
        el('td', {}, area.name),
        el('td', { class: 'num' }, String(areaCards.length)),
        el('td', { class: 'num' }, areaCards.length ? `${mastered}/${areaCards.length}` : '—'),
        el(
          'td',
          {},
          areaCards.length === 0
            ? el('span', { class: 'small', style: 'color:var(--warn)' }, 'no cards')
            : el(
                'div',
                { class: 'meter' },
                el('div', { class: 'fill', style: `width:${(mastered / areaCards.length) * 100}%` }),
              ),
        ),
      ),
    );
  }
  cacrepTable.appendChild(cbody);
  root.appendChild(el('div', { class: 'tablewrap' }, cacrepTable));

  // ---- forecast ----
  root.appendChild(el('h2', {}, 'What’s coming up over the next two weeks'));
  const forecast = app.dueForecast(14);
  const max = Math.max(1, ...forecast);
  const bars = el('div', { class: 'row', style: 'align-items:flex-end;gap:4px;height:90px' });
  forecast.forEach((n, i) => {
    bars.appendChild(
      el(
        'div',
        { style: 'flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px', title: `${n} due` },
        el('div', {
          style: `width:100%;background:var(--accent);border-radius:3px 3px 0 0;height:${(n / max) * 62}px;min-height:${n > 0 ? 2 : 0}px`,
        }),
        el('span', { class: 'small muted', style: 'font-size:.65rem' }, i === 0 ? 'now' : String(i)),
      ),
    );
  });
  root.appendChild(el('div', { class: 'card' }, bars));
}

function stat(n: string, label: string): HTMLElement {
  return el('div', { class: 'stat' }, el('div', { class: 'n' }, n), el('div', { class: 'l' }, label));
}
