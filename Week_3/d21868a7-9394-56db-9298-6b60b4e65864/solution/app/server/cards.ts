// Gate cards, strokes and holder succession. A stroke's effects apply only when the evidence store
// has confirmed its stroke record.
import type { User } from "./auth.ts";
import { tx, type Db } from "./db.ts";
import { formatMl } from "./decimal.ts";
import { ApiError, notFound } from "./http.ts";
import { canMove, nextStatus } from "./orderStates.ts";
import {
  CARD_SELECT,
  cardRecord,
  loadCard,
  loadOrder,
  loadWindow,
  orderRecord,
  windowRecord,
  type CardRow,
  type OrderRow,
} from "./records.ts";
import { putObject } from "./store.ts";
import { isoInstant } from "./time.ts";

const strokeKey = (cardId: number) => `strokes/${cardId}.json`;

/** The stroke record object: operator code only, never a name or phone. */
function strokeRecord(card: CardRow): Buffer {
  return Buffer.from(
    JSON.stringify({
      card_id: card.id,
      order_number: card.order_number,
      turnout: card.turnout,
      channel_id: card.channel_id,
      window_id: card.window_id,
      kind: card.kind,
      from_ml_day: formatMl(card.from_milli),
      to_ml_day: formatMl(card.to_milli),
      operator_code: card.stroke_operator_code,
      committed_at: isoInstant(card.committed_at!),
    }),
  );
}

/** Marks the card spent and applies its effects, once, when its stroke record is confirmed. */
async function confirmStroke(cardId: number): Promise<void> {
  await tx(async (db) => {
    const spent = await db.query(
      "UPDATE gate_card SET state = 'spent', confirmed_at = now() WHERE id = $1 AND state = 'waiting-for-store' RETURNING id",
      [cardId],
    );
    if (!spent.rowCount) return;
    const card = (await loadCard(db, cardId))!;
    const order = (await loadOrder(db, card.order_number))!;
    if (card.kind === "start") {
      if (!canMove("startConfirmed", order.status)) return;
      await db.query("UPDATE water_order SET status = $2, flow_started_at = now() WHERE number = $1", [
        order.number, nextStatus("startConfirmed", order.status),
      ]);
      await db.query(
        "INSERT INTO gate_card (order_number, kind, state, holder_code, from_milli, to_milli) VALUES ($1, 'finish', 'open', $2, $3, 0)",
        [order.number, order.holder_code, order.rate_milli],
      );
    } else {
      const status = canMove("finishConfirmed", order.status) ? nextStatus("finishConfirmed", order.status) : order.status;
      await db.query("UPDATE water_order SET flow_stopped_at = now(), status = $2 WHERE number = $1", [order.number, status]);
    }
  });
}

/** Writes the stroke record and confirms the card; false while the store is not answering. */
export async function storeStroke(card: CardRow): Promise<boolean> {
  try {
    await putObject(strokeKey(card.id), strokeRecord(card), "application/json");
  } catch {
    return false;
  }
  await confirmStroke(card.id);
  return true;
}

// Strokes this server is still carrying from waiting-for-store to the store's answer. A card listing
// waits briefly for them, so a read that follows a stroke sees the card the stroke settled on.
const inFlight = new Set<Promise<unknown>>();
const SETTLE_WAIT_MS = 1500;

export async function strokesSettled(): Promise<void> {
  if (!inFlight.size) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...inFlight]),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, SETTLE_WAIT_MS); }),
  ]);
  clearTimeout(timer);
}

export function strokeCard(user: User, cardId: number) {
  const running = applyStroke(user, cardId);
  inFlight.add(running);
  const done = () => { inFlight.delete(running); };
  running.then(done, done);
  return running;
}

async function applyStroke(user: User, cardId: number) {
  const card = await tx(async (db) => {
    const found = await loadCard(db, cardId);
    if (!found) throw notFound();
    if (found.holder_code !== user.operator_code) {
      throw new ApiError(409, "not_holder", "This gate card has moved to another operator.");
    }
    if (found.state !== "open") throw new ApiError(409, "card_not_open", "This gate card has already been stroked.");
    if (found.kind === "start") {
      const window = (await loadWindow(db, found.window_id))!;
      if (window.status !== "open" && window.status !== "closing") {
        throw new ApiError(409, "window_not_open", "This window is not open yet.");
      }
    }
    await db.query(
      `UPDATE gate_card SET state = 'waiting-for-store', committed_at = now(), stroke_key = $2, stroke_operator_code = $3
       WHERE id = $1`,
      [cardId, strokeKey(cardId), user.operator_code],
    );
    return (await loadCard(db, cardId))!;
  });
  if (!(await storeStroke(card))) return { status: 202, body: { card: cardRecord(card) } };
  return tx(async (db) => {
    const done = await loadCard(db, cardId);
    if (!done) return { status: 202, body: { card: cardRecord(card) } };
    return {
      status: 200,
      body: {
        card: cardRecord(done),
        order: orderRecord((await loadOrder(db, done.order_number))!),
        window: windowRecord((await loadWindow(db, done.window_id))!),
      },
    };
  }, { lock: false });
}

/** Holder succession: the order's named standby, then the window's rostered operator, skipping anyone
 * erased and the operator being removed. Null when neither can take the card. */
async function successorFor(db: Db, order: OrderRow, removed: string): Promise<{ code: string; isStandby: boolean } | null> {
  const window = (await loadWindow(db, order.window_id))!;
  const candidates = [
    { code: order.standby_code, isStandby: true },
    { code: window.rostered_operator, isStandby: false },
  ];
  for (const candidate of candidates) {
    if (candidate.code === null || candidate.code === removed) continue;
    const usable = await db.query("SELECT 1 FROM person WHERE operator_code = $1 AND NOT erased", [candidate.code]);
    if (usable.rowCount) return { code: candidate.code, isStandby: candidate.isStandby };
  }
  return null;
}

/** Hands one open card to its successor; false when there is none. */
export async function handOver(db: Db, card: CardRow, removed: string): Promise<boolean> {
  const order = (await loadOrder(db, card.order_number))!;
  const successor = await successorFor(db, order, removed);
  if (!successor) return false;
  await db.query("UPDATE gate_card SET holder_code = $2, handed_over = true WHERE id = $1", [card.id, successor.code]);
  await db.query(
    `UPDATE water_order SET holder_code = $2, standby_code = CASE WHEN $3 THEN NULL ELSE standby_code END WHERE number = $1`,
    [order.number, successor.code, successor.isStandby],
  );
  return true;
}

/** Issues an open start card to the order's holder or, when that holder has been erased, to the
 * successor the holder succession rule picks. */
export async function issueStartCard(db: Db, order: Pick<OrderRow, "number" | "holder_code" | "rate_milli">): Promise<void> {
  const issued = await db.query<{ id: number }>(
    "INSERT INTO gate_card (order_number, kind, state, holder_code, from_milli, to_milli) VALUES ($1, 'start', 'open', $2, 0, $3) RETURNING id",
    [order.number, order.holder_code, order.rate_milli],
  );
  const erased = await db.query("SELECT 1 FROM person WHERE operator_code = $1 AND erased", [order.holder_code]);
  if (erased.rowCount) await handOver(db, (await loadCard(db, issued.rows[0]!.id))!, order.holder_code);
}

export async function removeHolder(cardId: number) {
  return tx(async (db) => {
    const card = await loadCard(db, cardId);
    if (!card) throw notFound();
    if (card.state !== "open") throw new ApiError(409, "card_not_open", "This gate card is not open.");
    if (!(await handOver(db, card, card.holder_code))) {
      throw new ApiError(409, "no_successor", "No standby or rostered operator can take this card.");
    }
    const moved = (await loadCard(db, cardId))!;
    return { card: cardRecord(moved), order: orderRecord((await loadOrder(db, moved.order_number))!) };
  });
}

export async function listCards(db: Db, user: User, windowId: string | null) {
  const mine = user.role === "operator";
  const found = await db.query<CardRow>(
    `${CARD_SELECT}
     WHERE ($2::text IS NULL OR o.window_id = $2)
       AND (NOT $3 OR (g.holder_code = $1 AND g.state IN ('open', 'waiting-for-store'))
                   OR (g.stroke_operator_code = $1 AND g.state = 'spent' AND g.confirmed_at > now() - interval '24 hours'))
     ORDER BY g.id`,
    [user.operator_code, windowId, mine],
  );
  return found.rows.map(cardRecord);
}

/** Cards whose stroke record the store has not confirmed yet, oldest first. */
export async function waitingCards(db: Db): Promise<CardRow[]> {
  return (await db.query<CardRow>(`${CARD_SELECT} WHERE g.state = 'waiting-for-store' ORDER BY g.id`)).rows;
}
