import type { Queryable } from '../db';
import { putObject } from './storage';

export function scopeObjectKey(releaseId: string, snapshotVersion: number): string {
  return `releases/${releaseId}/scope-v${snapshotVersion}.json`;
}

/** Writes the next scope snapshot. The caller commits only once this resolves. */
export async function writeScopeSnapshot(
  db: Queryable,
  release: { id: string; name: string; target_date: string },
  snapshotVersion: number,
  frozenAt: string,
): Promise<void> {
  const { rows } = await db.query<{ id: string; name: string; board_position: number }>(
    'SELECT id, name, board_position FROM features WHERE release_id = $1 ORDER BY board_position, id',
    [release.id],
  );
  const payload = {
    releaseId: release.id,
    name: release.name,
    targetDate: release.target_date,
    snapshotVersion,
    frozenAt,
    features: rows.map((row, index) => ({ id: row.id, name: row.name, position: index + 1 })),
  };
  await putObject(
    scopeObjectKey(release.id, snapshotVersion),
    Buffer.from(JSON.stringify(payload), 'utf8'),
    'application/json',
  );
}
