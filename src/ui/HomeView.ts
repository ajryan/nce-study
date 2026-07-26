/**
 * Home — the "choose your path" screen the app opens on.
 *
 * The person studying is anxious about this exam, so this screen exists to give
 * them a calm, obvious entry point rather than dropping them straight into a
 * queue of cards. One clearly featured next action, a few gentle alternatives,
 * and a plain-language read on where they stand.
 */
import type { AppState, ViewName } from '../app';
import { el, clear, pct } from './dom';
import { queueStats } from '../scheduler/queue';
import { daysUntilExam } from '../scheduler/examDate';

/** Time-of-day greeting — small touch, makes the app feel like it noticed you. */
function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function renderHome(app: AppState, root: HTMLElement, go: (view: ViewName) => void): void {
  clear(root);

  const stats = queueStats(app.queue.slice(app.queueIndex));
  const daily = app.repo.getDaily();
  const doneToday = daily.new + daily.review;
  const counts = app.countsByState();
  const seen = app.cards.length - counts.new;
  const days = daysUntilExam(app.settings.examDate);

  // ---- hero ----
  const hero = el('div', { class: 'hero' });
  hero.appendChild(el('p', { class: 'greeting' }, `${greeting()} 👋`));
  hero.appendChild(
    el('h1', {}, stats.total > 0 ? 'Ready when you are' : "You're all caught up"),
  );

  hero.appendChild(
    el(
      'p',
      { class: 'encourage' },
      stats.total > 0
        ? 'No rush and no wrong pace — a few cards still counts.'
        : 'Nothing is due right now. Pick anything below if you feel like it.',
    ),
  );

  if (doneToday > 0) {
    hero.appendChild(
      el('div', { class: 'streak' }, `🎉 ${doneToday} card${doneToday === 1 ? '' : 's'} done today`),
    );
  }
  root.appendChild(hero);

  // ---- the paths ----
  const paths = el('div', { class: 'paths' });

  // Featured: the one thing we want them to do.
  paths.appendChild(
    pathCard({
      featured: true,
      cta: stats.total > 0 ? 'Start studying' : 'Look through cards',
      icon: stats.total > 0 ? '📚' : '✨',
      title: stats.total > 0 ? 'Study your cards' : 'Study anyway',
      desc:
        stats.total > 0
          ? 'A mix of new material and things due for review, shuffled across topics so it sticks.'
          : 'Nothing is due, but you can always look through cards you have already seen.',
      count:
        stats.total > 0
          ? `${stats.total} card${stats.total === 1 ? '' : 's'} ready` +
            (stats.due > 0 && stats.new > 0 ? ` · ${stats.due} review, ${stats.new} new` : '')
          : undefined,
      onClick: () => go(stats.total > 0 ? 'study' : 'browse'),
    }),
  );

  paths.appendChild(
    pathCard({
      icon: '🌱',
      cta: 'See my progress',
      title: 'See how I’m doing',
      desc: 'Your progress across every exam topic, and an honest read on what still needs work.',
      count: `${pct(seen, app.cards.length)} of the deck seen`,
      onClick: () => go('dashboard'),
    }),
  );

  paths.appendChild(
    pathCard({
      icon: '📝',
      cta: 'Start a practice test',
      title: 'Take a practice test',
      desc: 'A timed mock built to the real exam’s topic mix. Useful once you have covered a fair bit.',
      count: days !== null && days > 0 ? `${days} day${days === 1 ? '' : 's'} until your exam` : undefined,
      onClick: () => go('exam'),
    }),
  );

  paths.appendChild(
    pathCard({
      icon: '🔎',
      cta: 'Browse the cards',
      title: 'Look through the cards',
      desc: 'Search and read any card at your own pace — nothing is scored and nothing is scheduled.',
      count: `${app.cards.length} cards`,
      onClick: () => go('browse'),
    }),
  );

  root.appendChild(paths);

  // ---- gentle footer ----
  const footer = el('p', { class: 'small muted center', style: 'margin-top:1.5rem' });
  if (days !== null && days > 0) {
    footer.appendChild(
      document.createTextNode(
        `Your exam is in ${days} day${days === 1 ? '' : 's'}. Reviews are scheduled to land before then. `,
      ),
    );
  } else if (days === null) {
    footer.appendChild(document.createTextNode('Tip: adding your exam date helps pace your reviews. '));
  }
  footer.appendChild(
    el(
      'button',
      { class: 'btn ghost small', onclick: () => go('settings') },
      days === null ? 'Add exam date' : 'Settings',
    ),
  );
  root.appendChild(footer);
}

interface PathOptions {
  icon: string;
  title: string;
  desc: string;
  cta: string;
  count?: string;
  featured?: boolean;
  onClick: () => void;
}

/**
 * A card with an explicit button inside it, rather than a card that *is* a
 * button. The old version relied on a hover state to signal it was clickable,
 * which says nothing on touch and left the entry point ambiguous — the worst
 * place to be unsure, since everything else sits behind it.
 *
 * The whole card is still clickable for convenience, but the button is what
 * communicates that it can be.
 */
function pathCard(o: PathOptions): HTMLElement {
  return el(
    'div',
    {
      class: `path${o.featured ? ' featured' : ''}`,
      onclick: o.onClick,
      role: 'group',
    },
    el(
      'div',
      { class: 'path-body' },
      el('span', { class: 'icon' }, o.icon),
      el(
        'div',
        {},
        el('span', { class: 'title' }, o.title),
        el('span', { class: 'desc' }, o.desc),
        o.count ? el('span', { class: 'count' }, o.count) : null,
      ),
    ),
    el(
      'button',
      { class: 'btn primary cta', onclick: (e: Event) => { e.stopPropagation(); o.onClick(); } },
      o.cta,
    ),
  );
}
