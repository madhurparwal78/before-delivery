/** Price versions: each save is checked against the version the coordinator saw. */

import { query, queryOne, withTransaction, type Db } from '../db';
import { now } from '../clock';
import { ApiError } from '../errors';
import { applyLapseCheck } from './lapse';
import { lockUnit } from './units';
import { queueIndexUpdate } from '../search/pending';
import type { PriceVersionRow } from '../../shared/types';

export interface PriceSaveResult {
  code: string;
  price: number;
  priceVersion: number;
}

export async function savePrice(input: {
  code: string;
  price: number;
  expectedVersion: number;
  coordinatorId: string;
}): Promise<PriceSaveResult> {
  return withTransaction(async (client) => {
    await applyLapseCheck(client);
    const unit = await lockUnit(client, input.code);
    if (!unit) throw new ApiError('not_found');
    if (unit.status === 'withdrawn') throw new ApiError('unit_withdrawn');
    if (unit.price_version !== input.expectedVersion) throw new ApiError('stale_price');

    const version = input.expectedVersion + 1;
    const setAt = now();
    await query(client, 'update units set price = $2, price_version = $3 where code = $1', [
      input.code,
      input.price,
      version,
    ]);
    await query(
      client,
      'insert into price_versions (unit_code, version, price, set_by, set_at) values ($1, $2, $3, $4, $5)',
      [input.code, version, input.price, input.coordinatorId, setAt],
    );
    await queueIndexUpdate(client, input.code, 'upsert');
    return { code: input.code, price: input.price, priceVersion: version };
  });
}

export async function priceVersions(db: Db, code: string): Promise<PriceVersionRow[]> {
  const rows = await query<{ version: number; price: string; set_by_name: string; set_at: Date }>(
    db,
    `select v.version, v.price::text as price, a.name as set_by_name, v.set_at
       from price_versions v join accounts a on a.id = v.set_by
      where v.unit_code = $1 order by v.version desc`,
    [code],
  );
  return rows.map((row) => ({
    version: row.version,
    price: Number(row.price),
    setBy: row.set_by_name,
    setAt: row.set_at.toISOString(),
  }));
}

export async function unitExists(db: Db, code: string): Promise<boolean> {
  const row = await queryOne<{ code: string }>(db, 'select code from units where code = $1', [code]);
  return row !== null;
}
