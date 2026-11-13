import type { Ml } from '../../domain/decimal.ts';
import { turnoutMaxVolumeMl } from '../../domain/conversion.ts';
import { pickSuccessor } from '../../domain/succession.ts';
import { type Client, pool, type Queryable } from '../db.ts';
import { nextCardId } from '../schema.ts';
import type { WindowRow } from '../records.ts';
import type { AllocationFigures } from '../reads.ts';

/** Helpers every guarded step shares: locks, debits, credits and start cards. */

export interface TurnoutRow {
  code: string;
  channel_id: string;
  grower_id: number;
  max_rate_ml_day: string;
}

export async function turnoutRow(code: string, client?: Queryable): Promise<TurnoutRow | null> {
  const found = await (client ?? pool).query<TurnoutRow>(
    'select code, channel_id, grower_id, max_rate_ml_day from turnouts where code = $1',
    [code],
  );
  return found.rows[0] ?? null;
}

export function maxVolumeFor(turnout: TurnoutRow, hours: number): Ml {
  return turnoutMaxVolumeMl(BigInt(turnout.max_rate_ml_day), hours);
}

/** Takes the grower's allocation row, always after the window row. */
export async function lockAllocation(client: Client, growerId: number): Promise<AllocationFigures> {
  const found = await client.query<{ allocation_ml: string; debited_ml: string }>(
    'select allocation_ml, debited_ml from users where id = $1 for update',
    [growerId],
  );
  const row = found.rows[0] as { allocation_ml: string; debited_ml: string };
  const allocationMl = BigInt(row.allocation_ml);
  const debitedMl = BigInt(row.debited_ml);
  return { allocationMl, debitedMl, remainingMl: allocationMl - debitedMl };
}

export async function debitWindowAndAllocation(
  client: Client,
  windowId: string,
  growerId: number,
  volumeMl: Ml,
): Promise<void> {
  await client.query('update windows set committed_ml = committed_ml + $1 where id = $2', [
    volumeMl.toString(),
    windowId,
  ]);
  await client.query('update users set debited_ml = debited_ml + $1 where id = $2', [volumeMl.toString(), growerId]);
}

export async function creditWindowAndAllocation(
  client: Client,
  windowId: string,
  growerId: number,
  volumeMl: Ml,
): Promise<void> {
  await client.query('update windows set committed_ml = committed_ml - $1 where id = $2', [
    volumeMl.toString(),
    windowId,
  ]);
  await client.query('update users set debited_ml = debited_ml - $1 where id = $2', [volumeMl.toString(), growerId]);
}

export async function usableOperators(client: Queryable): Promise<ReadonlySet<string>> {
  const found = await client.query<{ code: string }>(
    "select operator_code as code from users where role = 'operator' and erased = false",
  );
  return new Set(found.rows.map((row) => row.code));
}

/** The order fields a start card is cut from. */
export interface CardOrder {
  number: string;
  holder_code: string;
  standby_code: string | null;
  rate_ml_day: string;
}

/** A start card goes to the order's holder, or to its successor when that holder is erased. */
export async function issueStartCard(client: Client, order: CardOrder, window: WindowRow): Promise<string> {
  const usable = await usableOperators(client);
  let holderCode = order.holder_code;
  if (!usable.has(holderCode)) {
    const successor = pickSuccessor({
      standbyCode: order.standby_code,
      rosteredOperator: window.rostered_operator,
      removedCode: order.holder_code,
      isUsable: (code) => usable.has(code),
    }) as { holderCode: string; clearStandby: boolean };
    holderCode = successor.holderCode;
    await client.query('update orders set holder_code = $1, standby_code = $2 where number = $3', [
      holderCode,
      successor.clearStandby ? null : order.standby_code,
      order.number,
    ]);
  }
  const cardId = await nextCardId(client);
  await client.query(
    `insert into gate_cards (id, order_number, kind, state, holder_code, from_ml_day, to_ml_day)
     values ($1,$2,'start','open',$3,'0',$4)`,
    [cardId, order.number, holderCode, order.rate_ml_day],
  );
  return cardId;
}

export async function removeOpenCards(client: Client, orderNumber: string): Promise<void> {
  await client.query("delete from gate_cards where order_number = $1 and state = 'open'", [orderNumber]);
}

export async function turnoutHasLiveOrder(
  client: Queryable,
  turnout: string,
  exceptOrderNumber: string | null,
): Promise<boolean> {
  const found = await client.query<{ number: string }>(
    `select number from orders
      where turnout = $1 and status in ('scheduled','running') and ($2::text is null or number <> $2)
      limit 1`,
    [turnout, exceptOrderNumber],
  );
  return found.rows[0] !== undefined;
}
