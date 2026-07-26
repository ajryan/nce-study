/**
 * Deck browser: search and filter every card, inspect its scheduling state,
 * and unsuspend anything that was set aside.
 */
import type { AppState } from '../app';
import { blueprint, resolveRefs, domainById } from '../data/loader';
import type { Card, CacrepArea } from '../data/schema';
import { el, clear, formatInterval } from './dom';
import { State } from '../scheduler/fsrs';

interface Filters {
  query: string;
  domain: string;
  cacrep: string;
  state: string;
  type: string;
}

const filters: Filters = { query: '', domain: '', cacrep: '', state: '', type: '' };
const PAGE_SIZE = 50;
let shown = PAGE_SIZE;

export function renderBrowse(app: AppState, root: HTMLElement): void {
  clear(root);
  root.appendChild(el('h1', {}, 'Browse deck'));

  const rerender = () => renderBrowse(app, root);
  const onFilterChange = () => {
    shown = PAGE_SIZE;
    rerender();
  };

  // ---- filter bar ----
  const bar = el('div', { class: 'filters' });

  bar.appendChild(
    el('input', {
      type: 'search',
      placeholder: 'Search prompts, answers, tags…',
      value: filters.query,
      oninput: (e: Event) => {
        filters.query = (e.target as HTMLInputElement).value;
        onFilterChange();
      },
    }),
  );

  bar.appendChild(
    select(
      filters.domain,
      [['', 'All domains'], ...blueprint.domains.map((d) => [d.id, `${d.id} · ${d.name}`] as [string, string])],
      (v) => {
        filters.domain = v;
        onFilterChange();
      },
    ),
  );

  bar.appendChild(
    select(
      filters.cacrep,
      [['', 'All CACREP areas'], ...blueprint.cacrepAreas.map((a) => [a.id, a.name] as [string, string])],
      (v) => {
        filters.cacrep = v;
        onFilterChange();
      },
    ),
  );

  bar.appendChild(
    select(
      filters.state,
      [
        ['', 'Any state'],
        ['new', 'Unseen'],
        ['learning', 'Learning'],
        ['review', 'In review'],
        ['due', 'Due now'],
        ['suspended', 'Suspended'],
        ['lapsed', 'Has lapses'],
      ],
      (v) => {
        filters.state = v;
        onFilterChange();
      },
    ),
  );

  bar.appendChild(
    select(
      filters.type,
      [
        ['', 'Any type'],
        ['mcq', 'MCQ'],
        ['scenario', 'Scenario'],
        ['recall', 'Recall'],
        ['cloze', 'Cloze'],
      ],
      (v) => {
        filters.type = v;
        onFilterChange();
      },
    ),
  );

  root.appendChild(bar);

  // ---- filtering ----
  const now = Date.now();
  const matches = app.cards.filter((card) => {
    const p = app.progressFor(card.id);

    if (filters.domain && card.domain !== filters.domain) return false;
    if (filters.cacrep && !card.cacrep.includes(filters.cacrep as CacrepArea)) return false;
    if (filters.type && card.type !== filters.type) return false;

    if (filters.state && p) {
      switch (filters.state) {
        case 'new': if (p.state !== State.New || p.suspended) return false; break;
        case 'learning': if (p.state !== State.Learning && p.state !== State.Relearning) return false; break;
        case 'review': if (p.state !== State.Review) return false; break;
        case 'due': if (p.suspended || new Date(p.due).getTime() > now) return false; break;
        case 'suspended': if (!p.suspended) return false; break;
        case 'lapsed': if (p.lapses === 0) return false; break;
      }
    }

    if (filters.query) {
      const q = filters.query.toLowerCase();
      const haystack = [
        card.prompt,
        card.answer ?? '',
        card.explanation,
        ...card.tags,
        ...(card.choices?.map((c) => c.text) ?? []),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  root.appendChild(
    el('p', { class: 'small muted' }, `${matches.length} card${matches.length === 1 ? '' : 's'} match.`),
  );

  const list = el('div');
  for (const card of matches.slice(0, shown)) {
    list.appendChild(renderRow(app, card, rerender));
  }
  root.appendChild(list);

  if (matches.length > shown) {
    root.appendChild(
      el(
        'button',
        {
          class: 'btn',
          style: 'margin-top:1rem',
          onclick: () => {
            shown += PAGE_SIZE;
            rerender();
          },
        },
        `Show ${Math.min(PAGE_SIZE, matches.length - shown)} more`,
      ),
    );
  }
}

function renderRow(app: AppState, card: Card, rerender: () => void): HTMLElement {
  const p = app.progressFor(card.id);
  const domain = domainById(card.domain);

  const stateLabel = !p
    ? 'unknown'
    : p.suspended
      ? 'suspended'
      : p.state === State.New
        ? 'unseen'
        : p.state === State.Review
          ? `review · due ${formatInterval((new Date(p.due).getTime() - Date.now()) / 86_400_000)}`
          : 'learning';

  const details = el('details', { class: 'browse-item' });
  details.appendChild(
    el(
      'summary',
      {},
      el('span', {}, card.prompt.slice(0, 110) + (card.prompt.length > 110 ? '…' : '')),
      el(
        'div',
        { class: 'meta' },
        `${domain?.id ?? card.domain} · ${card.task} · ${card.type} · ${stateLabel}` +
          (p && p.answerCount > 0 ? ` · ${p.correctCount}/${p.answerCount} correct` : '') +
          (p && p.lapses > 0 ? ` · ${p.lapses} lapse${p.lapses === 1 ? '' : 's'}` : ''),
      ),
    ),
  );

  const body = el('div', { style: 'padding:.5rem 0 .75rem' });

  if (card.choices) {
    const ul = el('ul', { style: 'margin:.3rem 0;padding-left:1.1rem' });
    for (const choice of card.choices) {
      ul.appendChild(
        el(
          'li',
          { style: choice.correct ? 'color:var(--correct);font-weight:600' : '' },
          choice.text,
          el('span', { class: 'rationale' }, choice.rationale),
        ),
      );
    }
    body.appendChild(ul);
  } else if (card.answer) {
    body.appendChild(el('div', { class: 'answerbox' }, card.answer));
  }

  body.appendChild(el('div', { class: 'explanation' }, card.explanation));

  const refs = resolveRefs(card.refs);
  body.appendChild(
    el(
      'div',
      { class: 'refs' },
      el(
        'ul',
        {},
        ...refs.map((r) =>
          el('li', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.label)),
        ),
      ),
    ),
  );

  if (p) {
    body.appendChild(
      el(
        'div',
        { class: 'row', style: 'margin-top:.6rem' },
        el(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              void app.repo.setSuspended(card.id, !p.suspended).then(() => {
                app.rebuildQueue();
                rerender();
              });
            },
          },
          p.suspended ? 'Unsuspend' : 'Suspend',
        ),
        el(
          'span',
          { class: 'small muted mono' },
          `stability ${p.stability.toFixed(1)}d · difficulty ${p.difficulty.toFixed(1)} · reps ${p.reps}`,
        ),
      ),
    );
  }

  details.appendChild(body);
  return details;
}

function select(
  value: string,
  options: Array<[string, string]>,
  onChange: (value: string) => void,
): HTMLElement {
  const node = el('select', {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
  });
  for (const [v, label] of options) {
    node.appendChild(el('option', { value: v, selected: v === value }, label));
  }
  return node;
}
