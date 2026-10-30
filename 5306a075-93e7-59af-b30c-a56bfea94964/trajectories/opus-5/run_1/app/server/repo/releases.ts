import type { Release, ReleaseStatus } from '../../shared/types';
import type { Queryable } from '../db';
import { toInstant } from '../domain/zone';

export interface ReleaseRow {
  id: string;
  name: string;
  target_date: string;
  is_public: boolean;
  status: ReleaseStatus;
  order_version: number;
  snapshot_version: number;
  shipped_at: Date | null;
}

export const RELEASE_COLUMNS =
  'id, name, target_date, is_public, status, order_version, snapshot_version, shipped_at';

export async function findReleaseRow(
  db: Queryable,
  workspaceId: string,
  releaseId: string,
): Promise<ReleaseRow | null> {
  const { rows } = await db.query<ReleaseRow>(
    `SELECT ${RELEASE_COLUMNS} FROM releases WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, releaseId],
  );
  return rows[0] ?? null;
}

export async function releaseFeatureIds(db: Queryable, releaseId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM features WHERE release_id = $1 ORDER BY board_position, id',
    [releaseId],
  );
  return rows.map((row) => row.id);
}

export async function releaseEmailCounts(
  db: Queryable,
  releaseId: string,
): Promise<{ queued: number; sent: number }> {
  const { rows } = await db.query<{ queued: string; sent: string }>(
    `SELECT COUNT(*) AS queued, COUNT(sent_at) AS sent FROM outbox WHERE release_id = $1`,
    [releaseId],
  );
  return { queued: Number(rows[0].queued), sent: Number(rows[0].sent) };
}

export async function toRelease(db: Queryable, row: ReleaseRow): Promise<Release> {
  const [featureIds, emails] = await Promise.all([
    releaseFeatureIds(db, row.id),
    releaseEmailCounts(db, row.id),
  ]);
  return {
    id: row.id,
    name: row.name,
    targetDate: row.target_date,
    targetMonth: row.target_date.slice(0, 7),
    status: row.status,
    isPublic: row.is_public,
    orderVersion: row.order_version,
    snapshotVersion: row.snapshot_version,
    featureIds,
    shippedAt: toInstant(row.shipped_at),
    emails,
  };
}

export async function listReleaseRows(db: Queryable, workspaceId: string): Promise<ReleaseRow[]> {
  const { rows } = await db.query<ReleaseRow>(
    `SELECT ${RELEASE_COLUMNS} FROM releases WHERE workspace_id = $1
      ORDER BY target_date, created_at, id`,
    [workspaceId],
  );
  return rows;
}

/** Renumbers a release's board positions to 0..n-1 and bumps its order version. */
export async function writeReleaseOrder(
  db: Queryable,
  releaseId: string,
  featureIds: readonly string[],
): Promise<number> {
  for (let index = 0; index < featureIds.length; index += 1) {
    await db.query('UPDATE features SET board_position = $1, release_id = $2 WHERE id = $3', [
      index,
      releaseId,
      featureIds[index],
    ]);
  }
  const { rows } = await db.query<{ order_version: number }>(
    'UPDATE releases SET order_version = order_version + 1 WHERE id = $1 RETURNING order_version',
    [releaseId],
  );
  return rows[0].order_version;
}
