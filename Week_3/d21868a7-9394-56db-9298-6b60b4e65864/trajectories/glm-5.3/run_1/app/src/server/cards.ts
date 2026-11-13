// Gate cards: strokes, store confirmation and holder succession.
import pg from "pg";
import { decAdd, decParse, decStr3 } from "../shared/decimal.ts";
import { formatInstant, truncateToSecond } from "../shared/district-time.ts";
import { ApiError } from "./errors.ts";
import { S3Config, s3Put, s3Get } from "./s3.ts";
import { Store, type CardRow, type OrderRow, type WindowRow } from "./store.ts";

export type StrokeOutcome = {
  status: 200 | 202;
  card: CardRow;
  order?: OrderRow;
  window?: WindowRow;
};

// Commit a stroke: card moves to waiting-for-store, the stroke record is
// written to the store, and only the confirmation applies the effects.
export async function commitStroke(
  store: Store,
  cardId: number,
  operatorCode: string,
  now: number,
): Promise<StrokeOutcome> {
  return store.transaction(async (client) => {
    const card = await lockCard(client, cardId);
    const order = await lockOrderCard(client, card.order_number);
    await store.lapseWindowIfNeeded(client, card.window_id, now);
    if (card.state !== "open") throw new ApiError(409, "card_not_open", "This gate card is no longer open.");
    if (card.holder_code !== operatorCode) throw new ApiError(409, "not_holder", "This gate card has moved to another operator.");
    // window status check for start strokes
    const wres = await client.query<{ opens_at: Date; closes_at: Date }>("SELECT opens_at, closes_at FROM windows WHERE id = $1", [card.window_id]);
    const w = wres.rows[0]!;
    if (card.kind === "start") {
      const opens = w.opens_at.getTime();
      const closes = w.closes_at.getTime();
      if (now < opens || now >= closes) {
        throw new ApiError(409, "window_not_open", "This window is not open yet.");
      }
    }

    const committedAt = truncateToSecond(now);
    const key = `strokes/${card.id}.json`;
    await client.query(
      `UPDATE gate_cards SET state = 'waiting-for-store', stroke_key = $1, stroke_committed_at = $2, stroke_operator = $3 WHERE id = $4`,
      [key, new Date(committedAt), operatorCode, card.id],
    );

    // order/card/window snapshot for the caller
    const after = await cardInTx(client, card.id);
    return { status: 202, card: after! };
  });
}

// The record object written to the object store.
export function strokeRecordJson(card: CardRow, operatorCode: string, committedAt: string): string {
  return JSON.stringify({
    card_id: String(card.id),
    order_number: card.order_number,
    turnout: card.turnout,
    channel_id: card.channel_id,
    window_id: card.window_id,
    kind: card.kind,
    from_ml_day: card.from_ml_day,
    to_ml_day: card.to_ml_day,
    operator_code: operatorCode,
    committed_at: committedAt,
  });
}

// Apply the stroke's effects once the store confirms. Returns the updated
// card, order and window. Idempotent: a second confirmation does nothing.
export async function confirmStroke(store: Store, cardId: number, confirmedAt: number): Promise<{ card: CardRow; order: OrderRow; window: WindowRow } | null> {
  return store.transaction(async (client) => {
    const card = await lockCard(client, cardId);
    if (card.state === "spent") {
      // already confirmed; nothing to do
      const order = await orderInTxCard(client, card.order_number);
      const win = await store.windowByIdInTx(client, card.window_id);
      return { card, order: order!, window: win! };
    }
    if (card.state !== "waiting-for-store" || card.stroke_key === null) return null;

    await client.query(`UPDATE gate_cards SET state = 'spent', stroke_confirmed_at = $1 WHERE id = $2`, [new Date(confirmedAt), card.id]);

    const order = await lockOrderCard(client, card.order_number);
    const window = await lockWindowRow(client, card.window_id);

    if (card.kind === "start") {
      await client.query(`UPDATE orders SET status = 'running' WHERE number = $1`, [card.order_number]);
      // issue the finish card to the order's current holder
      const holder = order.holder_code ?? window.rostered_operator;
      await client.query(
        `INSERT INTO gate_cards (order_number, turnout, channel_id, window_id, kind, state, holder_code, from_ml_day, to_ml_day)
         VALUES ($1,$2,$3,$4,'finish','open',$5,$6,'0.000')`,
        [card.order_number, card.turnout, card.channel_id, card.window_id, holder, order.rate_ml_day],
      );
    } else {
      // finish stroke: lower channel flow, move to delivered
      const isClosedAfterFlow = order.status === "closed" && order.closed_after_flow;
      if (isClosedAfterFlow) {
        // stays closed; delivered is unchanged; finish card spent
      } else {
        await client.query(`UPDATE orders SET status = 'delivered' WHERE number = $1`, [card.order_number]);
        await client.query(`UPDATE windows SET delivered_ml = $1 WHERE id = $2`, [
          decStr3(decAdd(decParse(window.delivered_ml)!, decParse(order.volume_ml)!)),
          card.window_id,
        ]);
      }
    }
    const afterCard = await cardInTx(client, card.id);
    const afterOrder = await orderInTxCard(client, card.order_number);
    const afterWindow = await store.windowByIdInTx(client, card.window_id);
    return { card: afterCard!, order: afterOrder!, window: afterWindow! };
  });
}

// --- holder succession -----------------------------------------------------------

export async function removeHolder(
  store: Store,
  cardId: number,
  now: number,
): Promise<{ card: CardRow; order: OrderRow }> {
  return store.transaction(async (client) => {
    const pre = await client.query<{ window_id: string }>("SELECT window_id FROM gate_cards WHERE id = $1", [cardId]);
    if (pre.rows[0]) await store.lapseWindowIfNeeded(client, pre.rows[0].window_id, now);
    const card = await lockCard(client, cardId);
    if (card.state !== "open") throw new ApiError(409, "card_not_open", "This gate card is no longer open.");
    const order = await lockOrderCard(client, card.order_number);
    const window = await lockWindowRow(client, card.window_id);
    const successor = await findSuccessor(client, order, window.rostered_operator, card.holder_code);
    if (!successor) throw new ApiError(409, "no_successor", "No standby or rostered operator can take this card.");
    await client.query(`UPDATE gate_cards SET holder_code = $1 WHERE id = $2`, [successor, card.id]);
    if (successor === order.standby_code) {
      await client.query(`UPDATE orders SET holder_code = $1, standby_code = null WHERE number = $2`, [successor, order.number]);
    } else {
      await client.query(`UPDATE orders SET holder_code = $1 WHERE number = $2`, [successor, order.number]);
    }
    const after = await cardInTx(client, card.id);
    const afterOrder = await orderInTxCard(client, order.number);
    return { card: after!, order: afterOrder! };
  });
}

// Every open card the contractor holds moves to its successor.
export async function handOverAllCards(
  store: Store,
  operatorCode: string,
  now: number,
): Promise<string[]> {
  return store.transaction(async (client) => {
    const cards = await client.query<{ id: number }>(
      `SELECT id FROM gate_cards WHERE holder_code = $1 AND state = 'open' ORDER BY id`,
      [operatorCode],
    );
    const moved: string[] = [];
    for (const c of cards.rows) {
      const card = await lockCard(client, c.id);
      if (card.state !== "open") continue;
      const order = await lockOrderCard(client, card.order_number);
      const window = await lockWindowRow(client, card.window_id);
      const successor = await findSuccessor(client, order, window.rostered_operator, operatorCode);
      if (!successor) continue; // a rostered operator always exists for erasure
      await client.query(`UPDATE gate_cards SET holder_code = $1 WHERE id = $2`, [successor, card.id]);
      if (successor === order.standby_code) {
        await client.query(`UPDATE orders SET holder_code = $1, standby_code = null WHERE number = $2`, [successor, order.number]);
      } else {
        await client.query(`UPDATE orders SET holder_code = $1 WHERE number = $2`, [successor, order.number]);
      }
      moved.push(String(card.id));
    }
    return moved;
  });
}

async function findSuccessor(
  client: pg.PoolClient,
  order: OrderRow,
  rostered: string,
  removed: string,
): Promise<string | null> {
  const candidates = [order.standby_code, rostered].filter((c): c is string => c !== null && c !== removed);
  for (const code of candidates) {
    const res = await client.query<{ erased: boolean }>(
      "SELECT erased FROM people WHERE role = 'operator' AND operator_code = $1",
      [code],
    );
    if (res.rows[0] && !res.rows[0].erased) return code;
  }
  return null;
}

// --- helpers -------------------------------------------------------------------

async function lockCard(client: pg.PoolClient, cardId: number): Promise<CardRow> {
  const res = await client.query(`SELECT * FROM gate_cards WHERE id = $1 FOR UPDATE`, [cardId]);
  const r = res.rows[0];
  if (!r) throw new ApiError(404, "not_found", "There is no such record.");
  return {
    id: r.id,
    order_number: r.order_number,
    turnout: r.turnout,
    channel_id: r.channel_id,
    window_id: r.window_id,
    kind: r.kind,
    state: r.state,
    holder_code: r.holder_code,
    from_ml_day: r.from_ml_day,
    to_ml_day: r.to_ml_day,
    stroke_key: r.stroke_key,
    stroke:
      r.stroke_key !== null
        ? {
            key: r.stroke_key,
            committed_at: formatInstant(r.stroke_committed_at ? new Date(r.stroke_committed_at).getTime() : 0),
            confirmed_at: r.stroke_confirmed_at ? formatInstant(new Date(r.stroke_confirmed_at).getTime()) : null,
            operator_code: r.stroke_operator ?? "",
          }
        : null,
    created_at: r.created_at ? new Date(r.created_at).getTime() : 0,
  };
}

async function cardInTx(client: pg.PoolClient, cardId: number): Promise<CardRow | null> {
  const res = await client.query(`SELECT * FROM gate_cards WHERE id = $1`, [cardId]);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    order_number: r.order_number,
    turnout: r.turnout,
    channel_id: r.channel_id,
    window_id: r.window_id,
    kind: r.kind,
    state: r.state,
    holder_code: r.holder_code,
    from_ml_day: r.from_ml_day,
    to_ml_day: r.to_ml_day,
    stroke_key: r.stroke_key,
    stroke:
      r.stroke_key !== null
        ? {
            key: r.stroke_key,
            committed_at: formatInstant(r.stroke_committed_at ? new Date(r.stroke_committed_at).getTime() : 0),
            confirmed_at: r.stroke_confirmed_at ? formatInstant(new Date(r.stroke_confirmed_at).getTime()) : null,
            operator_code: r.stroke_operator ?? "",
          }
        : null,
    created_at: r.created_at ? new Date(r.created_at).getTime() : 0,
  };
}

async function lockOrderCard(client: pg.PoolClient, number: string): Promise<OrderRow> {
  const res = await client.query(
    `SELECT o.*, p.name AS grower_name FROM orders o JOIN people p ON p.id = o.grower_id WHERE o.number = $1 FOR UPDATE`,
    [number],
  );
  const r = res.rows[0];
  if (!r) throw new ApiError(404, "not_found", "There is no such record.");
  return {
    number: r.number,
    grower_id: r.grower_id,
    grower_name: r.grower_name,
    turnout: r.turnout,
    window_id: r.window_id,
    requested_ml: r.requested_ml,
    volume_ml: r.volume_ml,
    rate_ml_day: r.rate_ml_day,
    status: r.status,
    holder_code: r.holder_code,
    standby_code: r.standby_code,
    conflict: r.conflict,
    rationed: r.rationed,
    closed_after_flow: r.closed_after_flow,
    scheduled_at: r.scheduled_at ? new Date(r.scheduled_at).getTime() : null,
  };
}

async function orderInTxCard(client: pg.PoolClient, number: string): Promise<OrderRow | null> {
  const res = await client.query(
    `SELECT o.*, p.name AS grower_name FROM orders o JOIN people p ON p.id = o.grower_id WHERE o.number = $1`,
    [number],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    number: r.number,
    grower_id: r.grower_id,
    grower_name: r.grower_name,
    turnout: r.turnout,
    window_id: r.window_id,
    requested_ml: r.requested_ml,
    volume_ml: r.volume_ml,
    rate_ml_day: r.rate_ml_day,
    status: r.status,
    holder_code: r.holder_code,
    standby_code: r.standby_code,
    conflict: r.conflict,
    rationed: r.rationed,
    closed_after_flow: r.closed_after_flow,
    scheduled_at: r.scheduled_at ? new Date(r.scheduled_at).getTime() : null,
  };
}

async function lockWindowRow(client: pg.PoolClient, windowId: string): Promise<{ rostered_operator: string; delivered_ml: string }> {
  const res = await client.query(`SELECT * FROM windows WHERE id = $1 FOR UPDATE`, [windowId]);
  const r = res.rows[0];
  if (!r) throw new ApiError(404, "not_found", "There is no such record.");
  return { rostered_operator: r.rostered_operator, delivered_ml: r.delivered_ml };
}

// Write the stroke record to the store. Returns the stored key on success.
export async function writeStrokeRecord(cfg: S3Config, card: CardRow, operatorCode: string, committedAt: string): Promise<boolean> {
  const body = Buffer.from(strokeRecordJson(card, operatorCode, committedAt), "utf8");
  return s3Put(cfg, `strokes/${card.id}.json`, body, "application/json");
}

export async function readStrokeRecord(cfg: S3Config, card: CardRow): Promise<Buffer | null> {
  return s3Get(cfg, `strokes/${card.id}.json`);
}
