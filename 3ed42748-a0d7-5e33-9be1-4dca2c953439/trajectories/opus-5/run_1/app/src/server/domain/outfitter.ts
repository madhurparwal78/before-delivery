import { query, type Transaction } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { balanceIn, writeMovement } from './ledger.js';

export interface SatchelRow {
  satchel_id: string;
  name: string;
  price: number;
  colour: string;
}

export async function satchels(): Promise<SatchelRow[]> {
  return query<SatchelRow>('select satchel_id, name, price, colour from satchels order by ordinal');
}

export async function outfitterView(courierId: string, wornSatchelId: string): Promise<unknown> {
  const owned = new Set(
    (
      await query<{ satchel_id: string }>('select satchel_id from satchels_owned where courier_id = $1', [
        courierId,
      ])
    ).map((row) => row.satchel_id),
  );
  return {
    satchels: (await satchels()).map((satchel) => ({
      satchel_id: satchel.satchel_id,
      name: satchel.name,
      price: satchel.price,
      colour: satchel.colour,
      owned: owned.has(satchel.satchel_id),
      worn: satchel.satchel_id === wornSatchelId,
    })),
  };
}

export interface Purchase {
  satchel_id: string;
  balance: number;
  movement_id: string;
}

/** The purchase state checks: an unknown satchel, one already owned, or too few stamps. */
export async function refuseUnbuyable(
  tx: Transaction,
  courierId: string,
  satchelId: string,
): Promise<{ price: number; balance: number }> {
  await tx.lock(`stamps:${courierId}`);
  const satchel = await tx.one<SatchelRow>(
    'select satchel_id, name, price, colour from satchels where satchel_id = $1',
    [satchelId],
  );
  if (satchel === null) throw fail('not_found');
  const owned = await tx.one<{ satchel_id: string }>(
    'select satchel_id from satchels_owned where courier_id = $1 and satchel_id = $2',
    [courierId, satchelId],
  );
  if (owned !== null) throw fail('already_owned');
  const balance = await balanceIn(tx, courierId);
  if (balance < satchel.price) throw fail('insufficient_stamps');
  return { price: satchel.price, balance };
}

export async function recordPurchase(
  tx: Transaction,
  courierId: string,
  satchelId: string,
  priced: { price: number; balance: number },
  now: Date,
): Promise<Purchase> {
  const movementId = await writeMovement(tx, courierId, 'purchase', satchelId, -priced.price, now);
  await tx.query('insert into satchels_owned (courier_id, satchel_id) values ($1, $2)', [
    courierId,
    satchelId,
  ]);
  return {
    satchel_id: satchelId,
    balance: priced.balance - priced.price,
    movement_id: movementId,
  };
}
