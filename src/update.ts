/**
 * "A new version is available" detection.
 *
 * The site deploys on every push, and hashed assets are served cache-first, so
 * a tab left open — or an installed PWA — can sit on an old build indefinitely.
 * The service worker no longer calls skipWaiting() on install; it waits, this
 * module notices, and the user decides when to take the update.
 *
 * Nothing here blocks. Being interrupted mid-card by a modal would be worse than
 * running a slightly stale build.
 */

export interface UpdateController {
  /** True once a new version is installed and waiting to take over. */
  isAvailable(): boolean;
  /** Apply the update and reload. Resolves only if something goes wrong. */
  apply(): Promise<void>;
  /** Hide the prompt for this page load without applying. */
  dismiss(): void;
  isDismissed(): boolean;
}

/**
 * Watches a registration for a worker that has installed and is waiting.
 *
 * Split from the DOM so it can be tested against a fake registration — the
 * update path is notoriously the thing that ships broken, because exercising it
 * for real needs two deploys.
 */
export function createUpdateController(
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>,
  onAvailable: () => void,
  reload: () => void = () => location.reload(),
): UpdateController {
  let waiting: ServiceWorker | null = null;
  let dismissed = false;
  let reloading = false;

  const announce = (worker: ServiceWorker | null): void => {
    if (!worker || waiting === worker) return;
    waiting = worker;
    if (!dismissed) onAvailable();
  };

  void (async () => {
    const reg = await getRegistration();
    if (!reg) return;

    // Already waiting when the page loaded.
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // A worker reaching "installed" while one already controls the page
        // means an update, rather than the very first install.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          announce(installing);
        }
      });
    });

    // Once the new worker takes over, reload so the page runs the new code.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      reload();
    });
  })();

  return {
    isAvailable: () => waiting !== null && !dismissed,
    isDismissed: () => dismissed,
    dismiss: () => {
      dismissed = true;
    },
    async apply() {
      if (!waiting) return;
      // The reload is driven by controllerchange above; if the worker never
      // takes over, fall back to reloading anyway rather than hanging.
      waiting.postMessage('SKIP_WAITING');
      setTimeout(() => {
        if (!reloading) {
          reloading = true;
          reload();
        }
      }, 2000);
    },
  };
}
