/** Floor bands: releasing one makes its homes available, searchable and pinnable. */

import { query, queryOne, withTransaction } from '../db';
import { ApiError } from '../errors';
import { queueIndexUpdate, waitForIndexConfirmation } from '../search/pending';
import { FLOOR_BANDS, type BandId } from '../../shared/units';

export function isBandId(value: string): value is BandId {
  return FLOOR_BANDS.some((band) => band.id === value);
}

export async function releaseBand(band: BandId): Promise<{ band: BandId; releasedUnits: number }> {
  const result = await withTransaction(async (client) => {
    const row = await queryOne<{ released: boolean }>(
      client,
      'select released from floor_bands where id = $1 for update',
      [band],
    );
    if (!row) throw new ApiError('not_found');
    if (row.released) throw new ApiError('already_released');

    const released = await query<{ code: string }>(
      client,
      "update units set status = 'available' where band = $1 and status = 'unreleased' returning code",
      [band],
    );
    await query(client, 'update floor_bands set released = true where id = $1', [band]);
    for (const unit of released) await queueIndexUpdate(client, unit.code, 'upsert');
    return { band, releasedUnits: released.length, codes: released.map((unit) => unit.code) };
  });
  await waitForIndexConfirmation(result.codes, 5000);
  return { band: result.band, releasedUnits: result.releasedUnits };
}
