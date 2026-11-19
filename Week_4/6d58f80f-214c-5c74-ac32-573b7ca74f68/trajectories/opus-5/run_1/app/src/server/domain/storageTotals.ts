import { db, type Queryable } from '../db.js';
import { config } from '../config.js';
import type { StorageTotals } from '../../shared/types.js';

/** The sum of the confirmed sizes of every stored file, the bin included. */
export const storageTotals = async (tx: Queryable = db): Promise<StorageTotals> => {
  const { rows } = await tx.query<{ used: number; binned: number }>(
    `SELECT coalesce(sum(size),0)::bigint AS used,
            coalesce(sum(size) FILTER (WHERE state = 'binned'),0)::bigint AS binned
       FROM files`,
  );
  const row = rows[0];
  return {
    usedBytes: row?.used ?? 0,
    binBytes: row?.binned ?? 0,
    quotaBytes: config.storageQuotaBytes,
  };
};
