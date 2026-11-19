// Seen records: one row per link, finding and finding content. The buyer's count, the owner's
// per-buyer progress and the offers table all read these same rows.

import { query, type Row } from '../db/pool.js';

interface Progress {
  seen: number;
  total: number;
  materialUnseen: number;
}

interface VersionFinding extends Row {
  finding_id: string;
  content_hash: string;
  position: number;
  material: boolean;
}

export async function versionFindings(carId: string, number: number): Promise<VersionFinding[]> {
  return query<VersionFinding>(
    'SELECT finding_id, content_hash, position, material FROM version_finding WHERE car_id = $1 AND number = $2 ORDER BY position',
    [carId, number],
  );
}

export async function seenHashes(linkId: string): Promise<Map<string, Set<string>>> {
  const rows = await query<{ finding_id: string; content_hash: string; seen_at: Date }>(
    'SELECT finding_id, content_hash, seen_at FROM seen_record WHERE link_id = $1',
    [linkId],
  );
  const found = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = found.get(row.finding_id) ?? new Set<string>();
    set.add(row.content_hash);
    found.set(row.finding_id, set);
  }
  return found;
}

export async function seenAtOf(linkId: string): Promise<Map<string, Date>> {
  const rows = await query<{ finding_id: string; content_hash: string; seen_at: Date }>(
    'SELECT finding_id, content_hash, seen_at FROM seen_record WHERE link_id = $1',
    [linkId],
  );
  const found = new Map<string, Date>();
  for (const row of rows) found.set(`${row.finding_id}:${row.content_hash}`, row.seen_at);
  return found;
}

export function progressOf(frozen: VersionFinding[], seen: Map<string, Set<string>>): Progress {
  let count = 0;
  let materialUnseen = 0;
  for (const item of frozen) {
    const isSeen = seen.get(item.finding_id)?.has(item.content_hash) ?? false;
    if (isSeen) count += 1;
    else if (item.material) materialUnseen += 1;
  }
  return { seen: count, total: frozen.length, materialUnseen };
}

/** Progress for a link on its car's current version. */
export async function progressFor(carId: string, version: number, linkId: string): Promise<Progress> {
  const frozen = await versionFindings(carId, version);
  return progressOf(frozen, await seenHashes(linkId));
}
