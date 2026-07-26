/**
 * Persistence with graceful degradation.
 *
 * The single-file build is meant to be opened straight off disk, and browsers
 * restrict storage on `file://` origins — Safari blocks IndexedDB outright,
 * Chrome needs a launch flag. Rather than fail opaquely (which would look like
 * "the app lost my progress"), storage probes each tier at startup and reports
 * which one it actually got, so the UI can warn and push an export.
 *
 *   IndexedDB   durable, the normal case on http(s)
 *   localStorage durable-ish fallback, ~5MB
 *   memory      last resort; progress is lost on reload
 */
import { openDB, type IDBPDatabase } from 'idb';

export type StorageTier = 'indexeddb' | 'localstorage' | 'memory';

export interface KeyValueStore {
  readonly tier: StorageTier;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'nce-study';
const DB_VERSION = 1;
const STORE = 'kv';
const LS_PREFIX = 'nce-study:';

/** True when the tier survives a reload. Drives the warning banner. */
export function isDurable(tier: StorageTier): boolean {
  return tier !== 'memory';
}

class IndexedDbStore implements KeyValueStore {
  readonly tier = 'indexeddb' as const;
  constructor(private db: IDBPDatabase) {}

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.db.get(STORE, key)) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    await this.db.put(STORE, value, key);
  }
  async delete(key: string): Promise<void> {
    await this.db.delete(STORE, key);
  }
  async clear(): Promise<void> {
    await this.db.clear(STORE);
  }
}

class LocalStorageStore implements KeyValueStore {
  readonly tier = 'localstorage' as const;

  async get<T>(key: string): Promise<T | undefined> {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    localStorage.removeItem(LS_PREFIX + key);
  }
  async clear(): Promise<void> {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(LS_PREFIX)) localStorage.removeItem(key);
    }
  }
}

class MemoryStore implements KeyValueStore {
  readonly tier = 'memory' as const;
  private map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

async function tryIndexedDb(): Promise<KeyValueStore | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      },
    });
    // Opening can succeed where writing fails (private mode, partitioned
    // file:// origins), so prove it with a round-trip before committing.
    const store = new IndexedDbStore(db);
    await store.set('__probe', Date.now());
    await store.delete('__probe');
    return store;
  } catch {
    return null;
  }
}

async function tryLocalStorage(): Promise<KeyValueStore | null> {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = LS_PREFIX + '__probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return new LocalStorageStore();
  } catch {
    return null;
  }
}

let storePromise: Promise<KeyValueStore> | null = null;

/** Resolves the best available tier once and caches it. */
export function getStore(): Promise<KeyValueStore> {
  storePromise ??= (async () => {
    return (await tryIndexedDb()) ?? (await tryLocalStorage()) ?? new MemoryStore();
  })();
  return storePromise;
}

/** Test seam — lets tests inject a store and reset between cases. */
export function __setStore(store: KeyValueStore | null): void {
  storePromise = store ? Promise.resolve(store) : null;
}

export { MemoryStore };
