/**
 * App shell: bootstrap, tab routing, global keyboard handling.
 */
import './styles/app.css';
import { AppState, type ViewName } from './app';
import { el, clear } from './ui/dom';
import { renderReview, handleReviewKey, resetReviewView } from './ui/ReviewView';
import { renderHome } from './ui/HomeView';
import { renderDashboard } from './ui/DashboardView';
import { renderBrowse } from './ui/BrowseView';
import { renderSettings } from './ui/SettingsView';
import { renderExam, pauseExamTimer } from './ui/ExamView';
import { queueStats } from './scheduler/queue';
import { createUpdateController, type UpdateController } from './update';
import { hashForView, viewFromHash, DEFAULT_VIEW } from './router';

declare const __SINGLE_FILE__: boolean;

// Plain, human labels — this app is used by someone anxious about the exam, and
// the navigation should read like a person talking, not a system menu.
const TABS: Array<{ id: ViewName; label: string }> = [
  { id: 'home', label: 'Start' },
  { id: 'study', label: 'Study Cards' },
  { id: 'dashboard', label: 'My Progress' },
  { id: 'exam', label: 'Practice Test' },
  { id: 'browse', label: 'All Cards' },
  { id: 'settings', label: 'Settings' },
];

const app = new AppState();
const rootEl = document.getElementById('app')!;

/** Dismissed for the session only — the underlying condition doesn't change. */
let warningDismissed = false;

let updates: UpdateController | null = null;

function render(): void {
  clear(rootEl);
  rootEl.appendChild(renderHeader());

  // Banners live in their own container, not inside <main>. Every view's
  // render* function starts by clearing the element it is given, so anything
  // appended to <main> before the switch below is wiped out again.
  const banners = el('div', { class: 'banners' });

  if (updates?.isAvailable()) banners.appendChild(renderUpdateBanner());

  const warning = app.storageWarning;
  if (warning && !warningDismissed) {
    banners.appendChild(
      el(
        'div',
        { class: 'banner warn' },
        el('strong', {}, 'Progress will not be saved. '),
        warning,
        el(
          'div',
          { style: 'margin-top:.5rem' },
          el(
            'button',
            {
              class: 'btn',
              onclick: () => go('settings'),
            },
            'Go to export',
          ),
          ' ',
          el(
            'button',
            {
              class: 'btn',
              onclick: () => {
                warningDismissed = true;
                render();
              },
            },
            'Dismiss',
          ),
        ),
      ),
    );
  }

  if (banners.childNodes.length > 0) rootEl.appendChild(banners);

  const main = el('main');
  // Attached *before* the view renders into it. Views may call DOM APIs that
  // require a connected element — dialog.showModal() throws InvalidStateError
  // on a detached node — and because rootEl has already been cleared, such a
  // throw used to leave the user staring at a blank page.
  rootEl.appendChild(main);

  try {
    switch (app.view) {
      case 'home': renderHome(app, main, go); break;
      case 'study': renderReview(app, main, go); break;
      case 'dashboard': renderDashboard(app, main, go); break;
      case 'browse': renderBrowse(app, main); break;
      case 'exam': renderExam(app, main); break;
      case 'settings': renderSettings(app, main); break;
    }
  } catch (err: unknown) {
    // A half-rendered view is recoverable; a blank screen is not. Someone
    // anxious about this exam should never be left with nothing on the page
    // and no idea whether their progress went with it.
    console.error(err);
    renderViewFailure(main, err);
  }
}

/** Last resort when a view throws: say what is true, and offer a way out. */
function renderViewFailure(main: HTMLElement, err: unknown): void {
  clear(main);
  main.appendChild(
    el(
      'div',
      { class: 'card' },
      el('h1', {}, 'Something went wrong on this screen'),
      el(
        'p',
        {},
        'Your progress is safe. Everything you’ve studied is saved on this device, and only ' +
          'this screen failed to draw.',
      ),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn primary', onclick: () => go('home') }, 'Back to start'),
        el('button', { class: 'btn', onclick: () => location.reload() }, 'Reload the page'),
      ),
      el(
        'p',
        { class: 'small muted', style: 'margin-top:1rem' },
        err instanceof Error ? err.message : String(err),
      ),
    ),
  );
}

/**
 * Non-blocking, and never a modal. Being interrupted mid-card would be worse
 * than running a slightly stale build — and the reassurance is the point, since
 * "reload to update" reads as "lose your place" to someone anxious.
 */
function renderUpdateBanner(): HTMLElement {
  return el(
    'div',
    { class: 'banner update' },
    el('span', { class: 'icon' }, '✨'),
    el(
      'div',
      { class: 'body' },
      el('strong', {}, 'A new version is ready'),
      el(
        'span',
        {},
        'Refreshing takes a second. Your progress is saved on this device and will still be ' +
          'here afterwards.',
      ),
    ),
    el(
      'div',
      { class: 'acts' },
      el('button', { class: 'btn primary', onclick: () => void updates?.apply() }, 'Refresh now'),
      el(
        'button',
        {
          class: 'btn ghost',
          onclick: () => {
            updates?.dismiss();
            render();
          },
        },
        'Later',
      ),
    ),
  );
}

/**
 * Switches to a view. Every arrival goes through here — a tab click, a button
 * in a card, the browser Back button, or a URL pasted into a fresh tab — so
 * view-specific cleanup cannot be skipped by any of those routes.
 */
function applyView(view: ViewName): void {
  if (app.view === view) {
    render();
    return;
  }
  if (app.view === 'exam' && view !== 'exam') pauseExamTimer();
  if (view === 'study') resetReviewView();
  app.view = view;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Navigates, via the URL. Changing the hash is what actually moves the app —
 * `applyView` runs from the hashchange handler — so a click and a Back button
 * press take exactly the same path, and the address bar can never disagree
 * with what is on screen.
 */
function go(view: ViewName): void {
  const target = hashForView(view);
  // Assigning an unchanged hash fires no event, so drive it directly.
  if (location.hash === target) applyView(view);
  else location.hash = target;
}

window.addEventListener('hashchange', () => {
  const view = viewFromHash(location.hash);
  // A hash naming nothing renders the default, so the address bar should say
  // so rather than leaving a URL that describes a screen the user isn't on.
  if (view === null) replaceHash(DEFAULT_VIEW);
  applyView(view ?? DEFAULT_VIEW);
});

/** Rewrites the address bar without adding a history entry. */
function replaceHash(view: ViewName): void {
  try {
    history.replaceState(null, '', hashForView(view));
  } catch {
    // Some browsers refuse replaceState on file:// — the single-file build
    // still routes, its URL just stays as typed.
  }
}

function renderHeader(): HTMLElement {
  const stats = queueStats(app.queue.slice(app.queueIndex));

  const nav = el('nav', { class: 'tabs' });
  for (const tab of TABS) {
    const label =
      tab.id === 'study' && stats.total > 0 ? `${tab.label} (${stats.total})` : tab.label;
    nav.appendChild(
      el(
        'button',
        {
          'aria-current': app.view === tab.id ? 'page' : null,
          onclick: () => go(tab.id),
        },
        label,
      ),
    );
  }

  return el(
    'header',
    { class: 'topbar' },
    el(
      'div',
      { class: 'topbar-inner' },
      el(
        'button',
        { class: 'brand', onclick: () => go('home'), title: 'Back to start' },
        'NCE Study',
        el('span', { class: 'dot' }, '.'),
        el('small', {}, 'your pace, your plan'),
      ),
      nav,
    ),
  );
}

document.addEventListener('keydown', (event) => {
  // Never hijack typing.
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (app.view === 'study') {
    if (handleReviewKey(app, event)) {
      event.preventDefault();
      return;
    }
  }

  // g + number jumps between tabs.
  const n = Number(event.key);
  if (event.shiftKey && n >= 1 && n <= TABS.length) {
    go(TABS[n - 1]!.id);
    event.preventDefault();
  }
});

app.onChange = render;

void app
  .init()
  .then(() => {
    const view = viewFromHash(location.hash) ?? DEFAULT_VIEW;
    // Normalise the address bar without adding a history entry, so Back from
    // the first screen leaves the app rather than bouncing within it.
    replaceHash(view);
    applyView(view);
  })
  .catch((err: unknown) => {
    clear(rootEl);
    rootEl.appendChild(
      el(
        'main',
        {},
        el('h1', {}, 'Failed to start'),
        el('p', { class: 'muted' }, err instanceof Error ? err.message : String(err)),
      ),
    );
  });

// Service worker only helps the hosted build; the single-file build is already
// self-contained and registering from file:// throws.
if (!__SINGLE_FILE__ && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    const registration = navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => undefined);

    updates = createUpdateController(
      () => registration,
      () => render(),
    );

    // Catch updates published while the tab sits open for hours.
    setInterval(
      () => {
        void registration.then((reg) => reg?.update().catch(() => undefined));
      },
      60 * 60 * 1000,
    );
  });
}
