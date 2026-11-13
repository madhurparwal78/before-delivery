/**
 * Erasing a consignor. The consignor shows `erasing` until MinIO has confirmed every
 * deletion, retrying while MinIO is unreachable, and only then `erased`. Erasing always
 * first asks MinIO which objects of theirs it holds.
 */

import type { AppContext } from '../http/context.js';
import { instantParam, type Database } from '../db.js';
import { piecePhotoPrefix } from './storage.js';
import { REFRESH_MS } from '../../shared/shop.js';

/** The pieces of an erased consignor whose photos must be gone: their unsold ones. */
async function unsoldPieceIds(db: Database, consignorId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT p.id FROM pieces p
      WHERE p.consignor_id = $1
        AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.piece_id = p.id AND s.refunded_at IS NULL)`,
    [consignorId],
  );
  return rows.map((row) => row.id);
}

/**
 * Asks MinIO what it holds for the consignor's unsold pieces, deletes it and confirms.
 * Returns true once nothing is left.
 */
export async function sweepErasure(app: AppContext, consignorId: string): Promise<boolean> {
  const pieceIds = await unsoldPieceIds(app.db, consignorId);
  for (const pieceId of pieceIds) {
    const keys = await app.storage.listKeys(piecePhotoPrefix(pieceId));
    for (const key of keys) {
      await app.storage.deleteObject(key);
    }
    const left = await app.storage.listKeys(piecePhotoPrefix(pieceId));
    if (left.length > 0) return false;
  }
  await app.db.query(`DELETE FROM photos WHERE piece_id = ANY($1::uuid[])`, [pieceIds]);
  await app.db.query(
    `UPDATE consignors SET status = 'erased', erased_at = COALESCE(erased_at, $2) WHERE id = $1`,
    [consignorId, instantParam(app.now())],
  );
  await app.db.query(`UPDATE erasures SET completed_at = $2 WHERE consignor_id = $1`, [
    consignorId,
    instantParam(app.now()),
  ]);
  return true;
}

/** Retries every unfinished erasure while MinIO is unreachable. */
export function startErasureWorker(app: AppContext): { stop: () => void } {
  const timer = setInterval(() => {
    void (async () => {
      const { rows } = await app.db.query<{ consignor_id: string }>(
        `SELECT consignor_id FROM erasures WHERE completed_at IS NULL`,
      );
      for (const row of rows) {
        await sweepErasure(app, row.consignor_id).catch(() => undefined);
      }
    })().catch(() => undefined);
  }, REFRESH_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
