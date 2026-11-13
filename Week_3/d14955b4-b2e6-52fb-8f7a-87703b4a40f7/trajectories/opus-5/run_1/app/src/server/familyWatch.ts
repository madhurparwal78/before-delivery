import { query } from './db';
import { config } from './config';

/** One shared ticker ends open streams whose refresh family is revoked or expired. */

const watchers = new Map<string, Set<() => void>>();
let ticker: NodeJS.Timeout | null = null;

async function sweep(): Promise<void> {
  const families = [...watchers.keys()];
  if (families.length === 0) return;
  const live = await query<{ id: string }>(
    `SELECT id FROM refresh_families
      WHERE id = ANY($1::text[]) AND revoked = false
        AND last_rotated_at + ($2 || ' seconds')::interval > now()`,
    [families, String(config.refreshFamilyTtlSeconds)],
  );
  const liveIds = new Set(live.rows.map((row) => row.id));
  for (const familyId of families) {
    if (liveIds.has(familyId)) continue;
    const listeners = watchers.get(familyId);
    watchers.delete(familyId);
    for (const listener of listeners ?? []) listener();
  }
}

function start(): void {
  if (ticker !== null) return;
  ticker = setInterval(() => {
    void sweep();
  }, 1_500);
  ticker.unref();
}

export function watchFamily(familyId: string, onEnded: () => void): () => void {
  const listeners = watchers.get(familyId) ?? new Set<() => void>();
  listeners.add(onEnded);
  watchers.set(familyId, listeners);
  start();
  return () => {
    const current = watchers.get(familyId);
    if (!current) return;
    current.delete(onEnded);
    if (current.size === 0) watchers.delete(familyId);
  };
}
