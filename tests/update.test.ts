/**
 * The update path is the thing that most often ships broken, because trying it
 * for real needs two deploys and a cooperating browser. These drive the logic
 * against a fake registration instead.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUpdateController } from '../src/update';

class FakeWorker extends EventTarget {
  state = 'installing';
  posted: unknown[] = [];
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  become(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn();
  startInstall(): FakeWorker {
    const w = new FakeWorker();
    this.installing = w;
    this.dispatchEvent(new Event('updatefound'));
    return w;
  }
}

/** Stand in for navigator.serviceWorker, whose controller decides "update vs first install". */
function stubServiceWorker(controlled: boolean) {
  const target = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: controlled ? {} : null,
      addEventListener: target.addEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    },
  });
  return target;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.useRealTimers();
});

describe('createUpdateController', () => {
  it('stays quiet on a first install, when nothing is controlling the page yet', async () => {
    stubServiceWorker(false);
    const reg = new FakeRegistration();
    const onAvailable = vi.fn();
    const c = createUpdateController(async () => reg as never, onAvailable);
    await settle();

    reg.startInstall().become('installed');
    await settle();

    // A first install is not an update, and prompting to refresh would be absurd.
    expect(onAvailable).not.toHaveBeenCalled();
    expect(c.isAvailable()).toBe(false);
  });

  it('announces an update once a new worker installs behind an existing one', async () => {
    stubServiceWorker(true);
    const reg = new FakeRegistration();
    const onAvailable = vi.fn();
    const c = createUpdateController(async () => reg as never, onAvailable);
    await settle();

    const w = reg.startInstall();
    w.become('installing');
    await settle();
    expect(c.isAvailable()).toBe(false); // not ready yet

    w.become('installed');
    await settle();
    expect(onAvailable).toHaveBeenCalledOnce();
    expect(c.isAvailable()).toBe(true);
  });

  it('notices a worker that was already waiting when the page loaded', async () => {
    stubServiceWorker(true);
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker();
    const onAvailable = vi.fn();
    const c = createUpdateController(async () => reg as never, onAvailable);
    await settle();

    expect(c.isAvailable()).toBe(true);
    expect(onAvailable).toHaveBeenCalledOnce();
  });

  it('tells the waiting worker to take over when applied', async () => {
    stubServiceWorker(true);
    const reg = new FakeRegistration();
    const waiting = new FakeWorker();
    reg.waiting = waiting;
    const c = createUpdateController(async () => reg as never, vi.fn(), vi.fn());
    await settle();

    await c.apply();
    expect(waiting.posted).toEqual(['SKIP_WAITING']);
  });

  it('reloads once the new worker takes control', async () => {
    const sw = stubServiceWorker(true);
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker();
    const reload = vi.fn();
    createUpdateController(async () => reg as never, vi.fn(), reload);
    await settle();

    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads only once, however many controllerchange events arrive', async () => {
    const sw = stubServiceWorker(true);
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker();
    const reload = vi.fn();
    createUpdateController(async () => reg as never, vi.fn(), reload);
    await settle();

    sw.dispatchEvent(new Event('controllerchange'));
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads anyway if the worker never takes over', async () => {
    vi.useFakeTimers();
    stubServiceWorker(true);
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker();
    const reload = vi.fn();
    const c = createUpdateController(async () => reg as never, vi.fn(), reload);
    await vi.advanceTimersByTimeAsync(0);

    await c.apply();
    expect(reload).not.toHaveBeenCalled();
    // Without a fallback the button would appear to do nothing forever.
    await vi.advanceTimersByTimeAsync(2100);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('stays dismissed for the rest of the page load', async () => {
    stubServiceWorker(true);
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker();
    const c = createUpdateController(async () => reg as never, vi.fn(), vi.fn());
    await settle();

    expect(c.isAvailable()).toBe(true);
    c.dismiss();
    expect(c.isAvailable()).toBe(false);
    expect(c.isDismissed()).toBe(true);
  });

  it('does nothing when there is no registration at all', async () => {
    stubServiceWorker(false);
    const onAvailable = vi.fn();
    const c = createUpdateController(async () => undefined, onAvailable);
    await settle();
    expect(c.isAvailable()).toBe(false);
    expect(onAvailable).not.toHaveBeenCalled();
    await expect(c.apply()).resolves.toBeUndefined();
  });
});
