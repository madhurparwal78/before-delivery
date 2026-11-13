import { formatMl } from '../../domain/decimal.ts';
import { ApiError } from '../../domain/errors.ts';
import { isLegalMove } from '../../domain/orders.ts';
import { pickSuccessor } from '../../domain/succession.ts';
import { formatInstant, windowStatus } from '../../domain/time.ts';
import type { SignedInUser } from '../auth.ts';
import { type Client, pool, transaction } from '../db.ts';
import { cardRows, channelFlows, lockWindowRow, orderRow, serverNow, windowRow } from '../reads.ts';
import { cardRecord, orderRecord, windowRecord, type CardRow, type OrderRow, type WindowRow } from '../records.ts';
import { nextCardId } from '../schema.ts';
import { usableOperators } from './common.ts';
import { putObject, StoreUnavailableError } from '../store.ts';

/** Gate card strokes. A card's effects apply only once the store confirms it. */

const STROKE_REPLY_WINDOW_MS = 4_500;

function strokeKeyFor(cardId: string): string {
  return `strokes/${cardId}.json`;
}

async function cardById(cardId: string, client?: Client): Promise<CardRow | null> {
  const found = await cardRows({ id: cardId }, client ?? pool);
  return found[0] ?? null;
}

export interface StrokeOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function strokeCard(user: SignedInUser, cardId: string): Promise<StrokeOutcome> {
  if ((await cardById(cardId)) === null) throw new ApiError('not_found');
  const operatorCode = user.operatorCode as string;

  await transaction(async (client) => {
    const locked = await client.query<{ state: string; holder_code: string; kind: string; order_number: string }>(
      'select state, holder_code, kind, order_number from gate_cards where id = $1 for update',
      [cardId],
    );
    const card = locked.rows[0] as { state: string; holder_code: string; kind: string; order_number: string };
    if (card.holder_code !== operatorCode) throw new ApiError('not_holder');
    if (card.state !== 'open') throw new ApiError('card_not_open');

    const order = (await orderRow(card.order_number, client)) as OrderRow;
    const window = (await windowRow(order.window_id, client)) as WindowRow;
    if (card.kind === 'start') {
      const status = windowStatus(window.opens_at, window.closes_at, serverNow());
      if (status !== 'open' && status !== 'closing') throw new ApiError('window_not_open');
    }

    await client.query(
      `update gate_cards set state = 'waiting-for-store', stroke_key = $2, committed_at = $3, operator_code = $4
        where id = $1`,
      [cardId, strokeKeyFor(cardId), serverNow(), operatorCode],
    );
  });

  const attempt = storeAndConfirm(cardId);
  attempt.catch(() => undefined);
  const confirmed = await Promise.race([
    attempt,
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), STROKE_REPLY_WINDOW_MS).unref();
    }),
  ]);

  const card = (await cardById(cardId)) as CardRow;
  const now = serverNow();
  if (!confirmed || card.state !== 'spent') {
    return { status: 202, body: { card: cardRecord(card, now) } };
  }
  const order = (await orderRow(card.order_number)) as OrderRow;
  const window = (await windowRow(order.window_id)) as WindowRow;
  return {
    status: 200,
    body: {
      card: cardRecord(card, now),
      order: orderRecord(order),
      window: windowRecord(window, now, await channelFlows()),
    },
  };
}

/** Writes the stroke record, then applies the stroke's effects. */
export async function storeAndConfirm(cardId: string): Promise<boolean> {
  const card = await cardById(cardId);
  if (card === null || card.state !== 'waiting-for-store' || card.committed_at === null) return false;

  const record = {
    card_id: card.id,
    order_number: card.order_number,
    turnout: card.turnout,
    channel_id: card.channel_id,
    window_id: card.window_id,
    kind: card.kind,
    from_ml_day: formatMl(BigInt(card.from_ml_day)),
    to_ml_day: formatMl(BigInt(card.to_ml_day)),
    operator_code: card.operator_code,
    committed_at: formatInstant(card.committed_at),
  };

  try {
    await putObject(strokeKeyFor(cardId), Buffer.from(JSON.stringify(record), 'utf8'), 'application/json');
  } catch (cause) {
    if (cause instanceof StoreUnavailableError) return false;
    throw cause;
  }

  await confirmStroke(cardId);
  return true;
}

async function confirmStroke(cardId: string): Promise<void> {
  await transaction(async (client) => {
    const locked = await client.query<{ order_number: string; kind: 'start' | 'finish'; to_ml_day: string }>(
      `select order_number, kind, to_ml_day from gate_cards
        where id = $1 and state = 'waiting-for-store' for update`,
      [cardId],
    );
    const card = locked.rows[0];
    if (card === undefined) return;

    const order = (await orderRow(card.order_number, client)) as OrderRow;
    await lockWindowRow(order.window_id, client);
    const window = (await windowRow(order.window_id, client)) as WindowRow;

    await client.query("update gate_cards set state = 'spent', confirmed_at = $2 where id = $1", [
      cardId,
      serverNow(),
    ]);

    if (card.kind === 'start') {
      if (!isLegalMove('start-stroke', order.status)) return;
      await client.query("update orders set status = 'running' where number = $1", [order.number]);
      const finishId = await nextCardId(client);
      await client.query(
        `insert into gate_cards (id, order_number, kind, state, holder_code, from_ml_day, to_ml_day)
         values ($1,$2,'finish','open',$3,$4,'0')`,
        [finishId, order.number, order.holder_code, order.rate_ml_day],
      );
      return;
    }

    if (order.closed_after_flow) return;
    if (!isLegalMove('finish-stroke', order.status)) return;
    await client.query("update orders set status = 'delivered' where number = $1", [order.number]);
    await client.query('update windows set delivered_ml = delivered_ml + $1 where id = $2', [
      order.volume_ml,
      window.id,
    ]);
  });
}

export async function removeHolder(cardId: string): Promise<Record<string, unknown>> {
  if ((await cardById(cardId)) === null) throw new ApiError('not_found');

  await transaction(async (client) => {
    const locked = await client.query<{ state: string; holder_code: string; order_number: string }>(
      'select state, holder_code, order_number from gate_cards where id = $1 for update',
      [cardId],
    );
    const card = locked.rows[0] as { state: string; holder_code: string; order_number: string };
    if (card.state !== 'open') throw new ApiError('card_not_open');

    const order = (await orderRow(card.order_number, client)) as OrderRow;
    const window = (await windowRow(order.window_id, client)) as WindowRow;
    const usable = await usableOperators(client);
    const successor = pickSuccessor({
      standbyCode: order.standby_code,
      rosteredOperator: window.rostered_operator,
      removedCode: card.holder_code,
      isUsable: (code) => usable.has(code),
    });
    if (successor === null) throw new ApiError('no_successor');

    await client.query('update gate_cards set holder_code = $2 where id = $1', [cardId, successor.holderCode]);
    await client.query('update orders set holder_code = $2, standby_code = $3 where number = $1', [
      order.number,
      successor.holderCode,
      successor.clearStandby ? null : order.standby_code,
    ]);
  });

  const card = (await cardById(cardId)) as CardRow;
  const order = (await orderRow(card.order_number)) as OrderRow;
  return { card: cardRecord(card, serverNow()), order: orderRecord(order) };
}

/** Moves every open card an operator holds, used when a contractor is erased. */
export async function handOverOpenCardsOf(client: Client, operatorCode: string): Promise<string[]> {
  const open = await client.query<{ id: string; order_number: string }>(
    "select id, order_number from gate_cards where holder_code = $1 and state = 'open' order by id for update",
    [operatorCode],
  );
  const usable = await usableOperators(client);
  const moved: string[] = [];
  for (const card of open.rows) {
    const order = (await orderRow(card.order_number, client)) as OrderRow;
    const window = (await windowRow(order.window_id, client)) as WindowRow;
    const successor = pickSuccessor({
      standbyCode: order.standby_code,
      rosteredOperator: window.rostered_operator,
      removedCode: operatorCode,
      isUsable: (code) => usable.has(code),
    }) as { holderCode: string; clearStandby: boolean };
    await client.query('update gate_cards set holder_code = $2 where id = $1', [card.id, successor.holderCode]);
    await client.query('update orders set holder_code = $2, standby_code = $3 where number = $1', [
      order.number,
      successor.holderCode,
      successor.clearStandby ? null : order.standby_code,
    ]);
    moved.push(card.id);
  }
  return moved;
}
