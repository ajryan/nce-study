/**
 * Link-checks every URL in content/references.json.
 *
 * A citation that 404s is worse than no citation: it looks authoritative and
 * silently isn't. This is deliberately a separate script from `validate`
 * because it needs network access and is therefore not suitable for CI on
 * every commit — run it when adding references and periodically thereafter.
 *
 *   npx tsx scripts/check-links.ts
 */
import { readFileSync } from 'node:fs';

interface Reference {
  id: string;
  label: string;
  url: string;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TIMEOUT_MS = 20_000;

async function probe(url: string): Promise<{ ok: boolean; status: number | string }> {
  // Some hosts (notably NBCC and .gov sites) reject HEAD but allow GET, so
  // fall back to a ranged GET rather than reporting a false failure.
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          Accept: '*/*',
          ...(method === 'GET' ? { Range: 'bytes=0-2048' } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok || res.status === 206) return { ok: true, status: res.status };
      if (method === 'GET') return { ok: false, status: res.status };
    } catch (err) {
      if (method === 'GET') {
        return { ok: false, status: err instanceof Error ? err.name : 'ERR' };
      }
    }
  }
  return { ok: false, status: 'ERR' };
}

const { references } = JSON.parse(
  readFileSync(new URL('../content/references.json', import.meta.url), 'utf8'),
) as { references: Reference[] };

console.log(`Checking ${references.length} reference URLs…\n`);

// Bounded concurrency — enough to be quick, polite enough not to look hostile.
const CONCURRENCY = 8;
const failures: Array<{ ref: Reference; status: number | string }> = [];
const queue = [...references];

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      const { ok, status } = await probe(ref.url);
      if (ok) {
        console.log(`  ok   ${String(status).padEnd(4)} ${ref.id}`);
      } else {
        console.log(`  FAIL ${String(status).padEnd(4)} ${ref.id}  ${ref.url}`);
        failures.push({ ref, status });
      }
    }
  }),
);

console.log(`\n${references.length - failures.length}/${references.length} reachable.`);

if (failures.length > 0) {
  console.log('\nBroken references:');
  for (const { ref, status } of failures) {
    console.log(`  [${status}] ${ref.id} — ${ref.label}\n        ${ref.url}`);
  }
  process.exit(1);
}
