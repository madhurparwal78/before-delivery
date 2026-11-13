import { orderRateMlDay } from '../../domain/conversion.ts';
import { formatMl, type Ml } from '../../domain/decimal.ts';
import { ApiError, PLACE_WINDOW_FULL_MESSAGE, ValidationError, VALIDATION_COPY } from '../../domain/errors.ts';
import { isLegalMove } from '../../domain/orders.ts';
import { isOrderable, isTooEarly, windowStatus } from '../../domain/time.ts';
import type { SignedInUser } from '../auth.ts';
import { type Client, pool, transaction } from '../db.ts';
import { queueConflictNotice } from '../notices.ts';
import {
  allocationBody,
  allocationOf,
  channelFlows,
  lockWindowRow,
  orderRow,
  serverNow,
  windowRow,
} from '../reads.ts';
import { orderRecord, windowRecord, windowFigures, type OrderRow, type WindowRow } from '../records.ts';
import { nextOrderNumber } from '../schema.ts';
import {
  creditWindowAndAllocation,
  debitWindowAndAllocation,
  issueStartCard,
  lockAllocation,
  maxVolumeFor,
  removeOpenCards,
  turnoutHasLiveOrder,
  turnoutRow,
  usableOperators,
  type TurnoutRow,
} from './common.ts';
import { requireVolumeMl } from './validate.ts';

/** Placing an order, and every dispatcher and grower move on one. */

export interface PlaceInput {
  turnout: unknown;
  windowId: unknown;
  volumeMl: unknown;
  operatorCode: unknown;
  standbyCode: unknown;
}

async function growerWindow(user: SignedInUser, windowId: unknown): Promise<WindowRow> {
  if (typeof windowId !== 'string') throw new ApiError('not_found');
  const window = await windowRow(windowId);
  if (window === null) throw new ApiError('not_found');
  const reach = await turnoutsOfGrower(user.id);
  if (!reach.some((turnout) => turnout.channel_id === window.channel_id)) throw new ApiError('not_found');
  return window;
}

async function turnoutsOfGrower(growerId: number): Promise<TurnoutRow[]> {
  const found = await pool.query<TurnoutRow>(
    'select code, channel_id, grower_id, max_rate_ml_day from turnouts where grower_id = $1 order by code',
    [growerId],
  );
  return found.rows;
}

/** A turnout the caller owns, or 404 when it belongs to another grower. */
async function ownTurnout(user: SignedInUser, code: unknown): Promise<TurnoutRow> {
  if (typeof code !== 'string') throw new ApiError('not_found');
  const turnout = await turnoutRow(code);
  if (turnout === null || turnout.grower_id !== user.id) throw new ApiError('not_found');
  return turnout;
}

function checkTurnoutVolume(turnout: TurnoutRow, window: WindowRow, volumeMl: Ml): void {
  const maxVolume = maxVolumeFor(turnout, window.hours);
  if (volumeMl > maxVolume) {
    throw ValidationError.field('volume_ml', VALIDATION_COPY.turnoutLimit(turnout.code, formatMl(maxVolume)));
  }
}

export async function quoteOrder(
  user: SignedInUser,
  params: { windowId: string | null; volumeMl: string | null; turnout: string | null },
): Promise<Record<string, unknown>> {
  if (params.windowId === null) throw ValidationError.field('window', 'Choose a delivery window.');
  const window = await growerWindow(user, params.windowId);

  let turnout: TurnoutRow | null = null;
  if (params.turnout !== null) {
    const owned = await turnoutsOfGrower(user.id);
    turnout = owned.find((entry) => entry.code === params.turnout) ?? null;
    if (turnout === null || turnout.channel_id !== window.channel_id) {
      throw ValidationError.field('turnout', VALIDATION_COPY.turnoutOffChannel);
    }
  }

  const volumeMl = requireVolumeMl('volume_ml', params.volumeMl);
  if (turnout !== null) checkTurnoutVolume(turnout, window, volumeMl);

  const now = serverNow();
  return {
    rate_ml_day: formatMl(orderRateMlDay(volumeMl, window.hours)),
    turnout_max_ml: turnout === null ? null : formatMl(maxVolumeFor(turnout, window.hours)),
    window: windowRecord(window, now, await channelFlows()),
  };
}

export async function placeOrder(user: SignedInUser, input: PlaceInput): Promise<Record<string, unknown>> {
  const turnout = await ownTurnout(user, input.turnout);
  const window = await growerWindow(user, input.windowId);
  if (turnout.channel_id !== window.channel_id) {
    throw ValidationError.field('turnout', VALIDATION_COPY.turnoutOffChannel);
  }

  const volumeMl = requireVolumeMl('volume_ml', input.volumeMl);
  checkTurnoutVolume(turnout, window, volumeMl);

  const usable = await usableOperators(pool);
  const operatorCode = input.operatorCode;
  if (typeof operatorCode !== 'string' || !usable.has(operatorCode)) {
    throw ValidationError.field('operator_code', 'Choose an operator who has not been erased.');
  }
  const standbyCode = input.standbyCode === null || input.standbyCode === undefined ? null : input.standbyCode;
  if (standbyCode !== null && (typeof standbyCode !== 'string' || !usable.has(standbyCode))) {
    throw ValidationError.field('standby_code', 'Choose an operator who has not been erased.');
  }
  if (standbyCode !== null && standbyCode === operatorCode) {
    throw ValidationError.field('standby_code', 'Choose a different operator from the gate worker.');
  }

  const outcome = await transaction(async (client) => {
    const locked = (await lockWindowRow(window.id, client)) as WindowRow;
    const allocation = await lockAllocation(client, user.id);
    const now = serverNow();

    if (volumeMl > allocation.remainingMl) {
      return { kind: 'allocation' as const, remainingMl: allocation.remainingMl };
    }
    if (isTooEarly(locked.opens_at, now)) throw new ApiError('too_early');
    if (!isOrderable(locked.opens_at, locked.closes_at, now)) throw new ApiError('window_closed');
    if (await turnoutHasLiveOrder(client, turnout.code, null)) throw new ApiError('turnout_busy');

    const figures = windowFigures(locked);
    if (volumeMl > figures.remainingMl) {
      await queueConflictNotice(client, locked, user.id, volumeMl, allocation.remainingMl);
      return { kind: 'window_full' as const, remainingMl: figures.remainingMl };
    }

    const number = await nextOrderNumber(client);
    const rateMlDay = orderRateMlDay(volumeMl, locked.hours);
    await client.query(
      `insert into orders (number, grower_id, turnout, window_id, requested_ml, volume_ml, rate_ml_day, status,
          holder_code, standby_code, scheduled_at)
       values ($1,$2,$3,$4,$5,$5,$6,'scheduled',$7,$8,$9)`,
      [
        number,
        user.id,
        turnout.code,
        locked.id,
        volumeMl.toString(),
        rateMlDay.toString(),
        operatorCode,
        standbyCode,
        now,
      ],
    );
    await debitWindowAndAllocation(client, locked.id, user.id, volumeMl);
    await issueStartCard(
      client,
      { number, holder_code: operatorCode, standby_code: standbyCode, rate_ml_day: rateMlDay.toString() },
      locked,
    );
    return { kind: 'placed' as const, number };
  });

  if (outcome.kind === 'allocation') {
    throw ValidationError.field('volume_ml', VALIDATION_COPY.allocation(formatMl(outcome.remainingMl)));
  }
  if (outcome.kind === 'window_full') {
    throw new ApiError('window_full', { remaining_ml: formatMl(outcome.remainingMl) }, PLACE_WINDOW_FULL_MESSAGE);
  }
  return bodyFor(outcome.number, window.id, user.id);
}

async function bodyFor(orderNumber: string, windowId: string, growerId: number | null): Promise<Record<string, unknown>> {
  const now = serverNow();
  const flows = await channelFlows();
  const order = (await orderRow(orderNumber)) as OrderRow;
  const window = (await windowRow(windowId)) as WindowRow;
  const body: Record<string, unknown> = {
    order: orderRecord(order),
    window: windowRecord(window, now, flows),
  };
  if (growerId !== null) body.allocation = allocationBody(await allocationOf(growerId));
  return body;
}

export async function cancelOrder(user: SignedInUser, orderNumber: string): Promise<Record<string, unknown>> {
  const order = await orderRow(orderNumber);
  if (order === null || order.grower_id !== user.id) throw new ApiError('not_found');

  await transaction(async (client) => {
    await lockWindowRow(order.window_id, client);
    const current = await lockOrder(client, orderNumber);
    if (!isLegalMove('cancel', current.status)) throw new ApiError('illegal_transition');
    await lockAllocation(client, current.grower_id);
    if (current.status === 'scheduled') {
      await creditWindowAndAllocation(client, current.window_id, current.grower_id, BigInt(current.volume_ml));
      await removeOpenCards(client, current.number);
    }
    await client.query("update orders set status = 'closed', closed_after_flow = false where number = $1", [
      current.number,
    ]);
  });

  return bodyFor(order.number, order.window_id, user.id);
}

async function lockOrder(client: Client, orderNumber: string): Promise<OrderRow> {
  const found = await client.query<OrderRow>('select * from orders where number = $1 for update', [orderNumber]);
  return found.rows[0] as OrderRow;
}

export async function scheduleOrder(orderNumber: string): Promise<Record<string, unknown>> {
  const existing = await orderRow(orderNumber);
  if (existing === null) throw new ApiError('not_found');

  await transaction(async (client) => {
    const window = (await lockWindowRow(existing.window_id, client)) as WindowRow;
    const order = await lockOrder(client, orderNumber);
    if (!isLegalMove('schedule', order.status)) throw new ApiError('illegal_transition');

    const now = serverNow();
    if (windowStatus(window.opens_at, window.closes_at, now) === 'closed') throw new ApiError('window_closed');
    if (await turnoutHasLiveOrder(client, order.turnout, order.number)) throw new ApiError('turnout_busy');

    const allocation = await lockAllocation(client, order.grower_id);
    const volumeMl = BigInt(order.volume_ml);
    if (volumeMl > allocation.remainingMl) throw new ApiError('allocation_exceeded');
    if (volumeMl > windowFigures(window).remainingMl) throw new ApiError('window_full');

    await client.query(
      "update orders set status = 'scheduled', conflict = null, scheduled_at = $2 where number = $1",
      [order.number, now],
    );
    await debitWindowAndAllocation(client, window.id, order.grower_id, volumeMl);
    await issueStartCard(client, order, window);
  });

  return bodyFor(existing.number, existing.window_id, null);
}

export async function closeOrder(orderNumber: string): Promise<Record<string, unknown>> {
  const existing = await orderRow(orderNumber);
  if (existing === null) throw new ApiError('not_found');

  await transaction(async (client) => {
    await lockWindowRow(existing.window_id, client);
    const order = await lockOrder(client, orderNumber);
    if (!isLegalMove('dispatcher-close', order.status)) throw new ApiError('illegal_transition');

    if (order.status === 'running') {
      await client.query("update orders set status = 'closed', closed_after_flow = true where number = $1", [
        order.number,
      ]);
      return;
    }
    await lockAllocation(client, order.grower_id);
    if (order.status === 'scheduled') {
      await creditWindowAndAllocation(client, order.window_id, order.grower_id, BigInt(order.volume_ml));
      await removeOpenCards(client, order.number);
    }
    await client.query("update orders set status = 'closed', closed_after_flow = false where number = $1", [
      order.number,
    ]);
  });

  return bodyFor(existing.number, existing.window_id, null);
}

export async function reopenOrder(orderNumber: string): Promise<Record<string, unknown>> {
  const existing = await orderRow(orderNumber);
  if (existing === null) throw new ApiError('not_found');

  await transaction(async (client) => {
    const window = (await lockWindowRow(existing.window_id, client)) as WindowRow;
    const order = await lockOrder(client, orderNumber);
    if (!isLegalMove('reopen', order.status)) throw new ApiError('illegal_transition');
    if (!order.closed_after_flow) throw new ApiError('not_reopenable');

    const openFinish = await client.query<{ id: string }>(
      "select id from gate_cards where order_number = $1 and kind = 'finish' and state = 'open'",
      [order.number],
    );
    if (openFinish.rows[0] === undefined) throw new ApiError('not_reopenable');
    if (windowStatus(window.opens_at, window.closes_at, serverNow()) === 'closed') throw new ApiError('window_closed');
    if (await turnoutHasLiveOrder(client, order.turnout, order.number)) throw new ApiError('turnout_busy');

    await client.query("update orders set status = 'running', closed_after_flow = false where number = $1", [
      order.number,
    ]);
  });

  return bodyFor(existing.number, existing.window_id, null);
}
