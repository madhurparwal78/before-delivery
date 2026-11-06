import { formatCents } from '../../shared/money';
import { Rates, SETTINGS, Setting } from '../../shared/types';
import { Db, query, withTransaction } from '../db/pool';
import { writeAudit } from './audit';

export type RateCents = Record<Setting, number>;

export async function ratesMap(db: Db): Promise<RateCents> {
  const rows = await query<{ setting: Setting; cents: number }>(
    db,
    'select setting, cents from rates',
  );
  const map = {} as RateCents;
  for (const setting of SETTINGS) {
    const found = rows.find((row) => row.setting === setting);
    if (!found) throw new Error(`no hourly rate seeded for ${setting}`);
    map[setting] = found.cents;
  }
  return map;
}

export function ratesResponse(map: RateCents): Rates {
  return {
    medical: formatCents(map.medical),
    legal: formatCents(map.legal),
    education: formatCents(map.education),
    community: formatCents(map.community),
  };
}

export async function saveRates(
  actorId: string,
  patch: Partial<RateCents>,
): Promise<RateCents> {
  return withTransaction(async (client) => {
    const before = await ratesMap(client);
    for (const setting of SETTINGS) {
      const cents = patch[setting];
      if (cents === undefined) continue;
      await client.query('update rates set cents = $2 where setting = $1', [setting, cents]);
    }
    const after = await ratesMap(client);
    await writeAudit(client, {
      actorId,
      action: 'rates.updated',
      entity: 'rates',
      entityId: 'rates',
      requestId: null,
      detail: { before: ratesResponse(before), after: ratesResponse(after) },
    });
    return after;
  });
}
