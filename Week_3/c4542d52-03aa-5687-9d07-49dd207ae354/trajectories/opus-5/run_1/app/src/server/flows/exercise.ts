import type { Order, PaymentRecord } from "../../shared/types.js";
import { db } from "../db.js";
import { exerciseCostCents, formatCents, parseDecimal } from "../domain/money.js";
import { nextOrderId } from "../ids.js";
import { writeWithEvents } from "../live/events.js";
import { buildGrant, grantContext, loadGrantRowForUpdate } from "../model/grants.js";
import { buildOrder, loadOrder, loadOrderRow, noticeStatusFor, ORDER_COLUMNS, type OrderRow } from "../model/orders.js";
import { loadPerson } from "../model/people.js";
import { cancelPayment, createPayment, fetchPayment, ProviderUnavailableError } from "../services/payments.js";
import { exerciseNoticeText, recordPendingDocument, sealDocument } from "../services/documents.js";
import { VaultUnavailableError } from "../services/vault.js";
import { ApiError, conflict, unavailable, validation } from "../http/errors.js";
import { grantAudience } from "./audiences.js";
import { addShares, emitCapTable, writeLedgerEntry } from "./ledger.js";

const CONFIRM_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 2000;

const locks = new Map<string, Promise<unknown>>();
const polling = new Set<string>();

/** Serialises work that shares a name, so requests that arrive together are served one after another. */
export async function withLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(name) ?? Promise.resolve();
  const current = previous.then(run, run);
  locks.set(
    name,
    current.catch(() => undefined),
  );
  try {
    return await current;
  } finally {
    if (locks.get(name) === current) locks.delete(name);
  }
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

async function storeResponse(orderId: string, response: StoredResponse): Promise<void> {
  await db.query("update exercise_orders set response_status = $2, response_body = $3 where id = $1", [
    orderId,
    response.status,
    JSON.stringify(response.body),
  ]);
}

function providerHeld(order: Order): ApiError {
  return unavailable(
    "provider_unavailable",
    `The payment provider can't be reached. Order ${order.id} is held under key ${order.idempotency_key}. Nothing has been issued.`,
    { order },
  );
}

export interface PlaceInput {
  holderId: string;
  grantId: string;
  options: number;
  idempotencyKey: string;
  now: Date;
}

export async function placeExercise(input: PlaceInput): Promise<StoredResponse> {
  return withLock(`key:${input.idempotencyKey}`, async () => {
    const existing = await db.queryOne<OrderRow>(
      `select ${ORDER_COLUMNS} from exercise_orders where idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing !== null) {
      if (existing.grant_id !== input.grantId || existing.options !== input.options) {
        throw conflict("idempotency_key_reused", "That idempotency key was already used for a different exercise.");
      }
      if (existing.response_status !== null) {
        return { status: existing.response_status, body: existing.response_body };
      }
      const order = await loadOrder(db, existing.id);
      return { status: 201, body: order };
    }
    const order = await createOrder(input);
    const response = await runPayment(order, input.now);
    await storeResponse(order.id, response);
    return response;
  });
}

async function createOrder(input: PlaceInput): Promise<Order> {
  return withLock(`grant:${input.grantId}`, async () =>
    writeWithEvents(async (tx, emit) => {
      const row = await loadGrantRowForUpdate(tx, input.grantId);
      if (row === null || row.state !== "accepted" || row.strike === null) {
        throw conflict("grant_not_exercisable", "This grant can't be exercised.");
      }
      const context = await grantContext(tx, input.now);
      const grant = buildGrant(row, context);
      const holder = await loadPerson(tx, input.holderId);
      if (holder !== null && holder.window_ends_at !== null && input.now.getTime() >= holder.window_ends_at.getTime()) {
        throw conflict("exercise_window_closed", "Your exercise window closed before this order arrived.");
      }
      if (input.options > grant.exercisable) {
        throw validation({ options: `Only ${grant.exercisable} vested options are available to exercise.` });
      }
      const strike = parseDecimal(row.strike, 4);
      if (strike === null) throw conflict("grant_not_exercisable", "This grant can't be exercised.");
      const cost = exerciseCostCents(input.options, strike);
      const id = await nextOrderId(tx);
      const created = await tx.query<OrderRow>(
        `insert into exercise_orders (id, grant_id, holder_id, options, strike, cost_cents, idempotency_key,
                                      state, placed_at, request_options)
         values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $4)
         returning ${ORDER_COLUMNS}`,
        [id, input.grantId, input.holderId, input.options, row.strike, Number(cost), input.idempotencyKey, input.now],
      );
      const inserted = created[0];
      if (inserted === undefined) throw new Error("the exercise order was not written");
      await emit(
        "order_changed",
        { order_id: id, grant_id: input.grantId, state: "pending", options: input.options, reason: "placed" },
        grantAudience(input.holderId),
      );
      return buildOrder(inserted, null);
    }),
  );
}

async function markHeld(orderId: string): Promise<Order> {
  return writeWithEvents(async (tx, emit) => {
    const rows = await tx.query<OrderRow>(
      `update exercise_orders set state = 'held' where id = $1 and state = 'pending' returning ${ORDER_COLUMNS}`,
      [orderId],
    );
    const row = rows[0] ?? (await loadOrderRow(tx, orderId));
    if (row === undefined || row === null) throw new Error(`order ${orderId} is missing`);
    await emit(
      "order_changed",
      { order_id: row.id, grant_id: row.grant_id, state: row.state, options: row.options, reason: "held" },
      grantAudience(row.holder_id),
    );
    return buildOrder(row, await noticeStatusFor(tx, row));
  });
}

async function savePayment(orderId: string, record: PaymentRecord): Promise<void> {
  await db.query(
    `update exercise_orders
        set payment_id = $2, payment_status = $3, payment_amount_cents = $4, payment_currency = $5,
            payment_reference = $6, payment_confirmed_at = $7
      where id = $1`,
    [
      orderId,
      record.id,
      record.status,
      record.amount_cents,
      record.currency,
      record.reference,
      record.confirmed_at === null ? null : new Date(record.confirmed_at),
    ],
  );
}

function centsOf(amount: string): number {
  const cents = parseDecimal(amount, 2);
  if (cents === null) throw new Error(`the amount ${amount} is not an exact cent figure`);
  return Number(cents);
}

function recordMatches(record: PaymentRecord, order: Order): boolean {
  return record.status === "confirmed" && record.amount_cents === centsOf(order.cost) && record.reference === order.id;
}

/** Sends the payment, then waits for the provider's record for at most five seconds. */
async function runPayment(order: Order, now: Date): Promise<StoredResponse> {
  let record: PaymentRecord;
  try {
    record = await createPayment({
      idempotencyKey: order.idempotency_key,
      amountCents: centsOf(order.cost),
      reference: order.id,
      description: `Exercise of ${order.options} options under ${order.grant_id}`,
    });
  } catch (error) {
    if (!(error instanceof ProviderUnavailableError)) throw error;
    const held = await markHeld(order.id);
    const apiError = providerHeld(held);
    return { status: 503, body: { error: { code: apiError.code, message: apiError.message }, order: held } };
  }
  await savePayment(order.id, record);
  const deadline = now.getTime() + CONFIRM_WAIT_MS;
  for (;;) {
    let fetched: PaymentRecord;
    try {
      fetched = await fetchPayment(record.id);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      const held = await markHeld(order.id);
      const apiError = providerHeld(held);
      return { status: 503, body: { error: { code: apiError.code, message: apiError.message }, order: held } };
    }
    await savePayment(order.id, fetched);
    if (recordMatches(fetched, order)) {
      const issued = await issueOrder(order.id, fetched);
      return { status: 201, body: issued };
    }
    if (fetched.status !== "pending") {
      const held = await markHeld(order.id);
      const apiError = providerHeld(held);
      return { status: 503, body: { error: { code: apiError.code, message: apiError.message }, order: held } };
    }
    if (Date.now() >= deadline) {
      startPolling(order.id, record.id);
      const pending = await loadOrder(db, order.id);
      return { status: 201, body: pending };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Issues the shares once, only for an order the provider has confirmed. */
export async function issueOrder(orderId: string, record: PaymentRecord): Promise<Order> {
  return withLock(`order:${orderId}`, async () => {
    const outcome = await writeWithEvents(async (tx, emit) => {
      const row = await tx.queryOne<OrderRow>(
        `select ${ORDER_COLUMNS} from exercise_orders where id = $1 for update`,
        [orderId],
      );
      if (row === null) throw new Error(`order ${orderId} is missing`);
      if (row.state === "cancelled") return { order: buildOrder(row, await noticeStatusFor(tx, row)), cancelled: true };
      if (row.state === "issued") return { order: buildOrder(row, await noticeStatusFor(tx, row)), cancelled: false };
      const issuedAt = new Date();
      await tx.query(
        `update exercise_orders
            set state = 'issued', issued_at = $2, payment_status = $3, payment_confirmed_at = $4
          where id = $1`,
        [orderId, issuedAt, record.status, record.confirmed_at === null ? issuedAt : new Date(record.confirmed_at)],
      );
      await tx.query("update grants set exercised = exercised + $2 where id = $1", [row.grant_id, row.options]);
      await addShares(tx, row.holder_id, "Common", row.options);
      await writeLedgerEntry(tx, {
        at: issuedAt,
        holderId: row.holder_id,
        kind: "exercise_issued",
        shareClass: "Common",
        sharesDelta: row.options,
        optionsDelta: -row.options,
        reference: row.id,
      });
      const fresh = await tx.queryOne<OrderRow>(`select ${ORDER_COLUMNS} from exercise_orders where id = $1`, [orderId]);
      if (fresh === null) throw new Error(`order ${orderId} is missing`);
      await emit(
        "order_changed",
        { order_id: row.id, grant_id: row.grant_id, state: "issued", options: row.options, reason: "issued" },
        grantAudience(row.holder_id),
      );
      await emitCapTable(emit);
      return { order: buildOrder(fresh, null), cancelled: false };
    });
    if (outcome.cancelled) {
      if (record.id !== "") await cancelPayment(record.id);
      return outcome.order;
    }
    if (outcome.order.state !== "issued") return outcome.order;
    return sealNotice(orderId);
  });
}

/** Seals the exercise notice for an issued order; the shares stay issued when the vault is down. */
export async function sealNotice(orderId: string): Promise<Order> {
  const prepared = await writeWithEvents(async (tx) => {
    const row = await loadOrderRow(tx, orderId);
    if (row === null) throw new Error(`order ${orderId} is missing`);
    const holder = await loadPerson(tx, row.holder_id);
    if (holder === null) throw new Error(`holder ${row.holder_id} is missing`);
    const document = await recordPendingDocument(tx, row.notice_document_id, {
      kind: "exercise_notice",
      title: `Exercise notice ${row.id}`,
      ownerId: row.holder_id,
      vaultKey: `exercise-notices/${row.id}.txt`,
      orderId: row.id,
      grantId: row.grant_id,
      body: exerciseNoticeText({
        orderId: row.id,
        grantId: row.grant_id,
        holderName: holder.name,
        options: row.options,
        strike: row.strike,
        cost: formatCents(BigInt(row.cost_cents)),
        paymentId: row.payment_id ?? "",
        issuedAt: (row.issued_at ?? new Date()).toISOString(),
      }),
    });
    await tx.query("update exercise_orders set notice_document_id = $2 where id = $1", [row.id, document.id]);
    return { row, document };
  });
  try {
    await writeWithEvents(async (tx, emit) => {
      await sealDocument(tx, prepared.document);
      await emit(
        "order_changed",
        {
          order_id: prepared.row.id,
          grant_id: prepared.row.grant_id,
          state: "issued",
          options: prepared.row.options,
          reason: "notice_sealed",
        },
        grantAudience(prepared.row.holder_id),
      );
    });
  } catch (error) {
    if (!(error instanceof VaultUnavailableError)) throw error;
  }
  const order = await loadOrder(db, orderId);
  if (order === null) throw new Error(`order ${orderId} is missing`);
  return order;
}

export function startPolling(orderId: string, paymentId: string): void {
  if (polling.has(orderId)) return;
  polling.add(orderId);
  const poll = async (): Promise<void> => {
    const row = await loadOrderRow(db, orderId).catch(() => null);
    if (row === null || row.state === "issued" || row.state === "cancelled") {
      polling.delete(orderId);
      return;
    }
    try {
      const record = await fetchPayment(paymentId);
      await savePayment(orderId, record);
      if (record.status === "confirmed" && record.amount_cents === row.cost_cents && record.reference === row.id) {
        await issueOrder(orderId, record);
        polling.delete(orderId);
        return;
      }
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
    }
    setTimeout(() => void poll(), POLL_INTERVAL_MS);
  };
  setTimeout(() => void poll(), POLL_INTERVAL_MS);
}

export async function resumePolling(): Promise<void> {
  const rows = await db.query<{ id: string; payment_id: string }>(
    "select id, payment_id from exercise_orders where state = 'pending' and payment_id is not null",
  );
  for (const row of rows) startPolling(row.id, row.payment_id);
}

export async function retryOrder(orderId: string, now: Date): Promise<Order> {
  return withLock(`retry:${orderId}`, async () => {
    const row = await loadOrderRow(db, orderId);
    if (row === null) throw new Error(`order ${orderId} is missing`);
    if (row.state === "issued") {
      const notice = await noticeStatusFor(db, row);
      if (notice === "sealed") throw conflict("nothing_to_retry", "There is nothing to retry on this order.");
      const sealed = await sealNotice(orderId);
      if (sealed.notice !== null && sealed.notice.status === "pending") {
        throw unavailable(
          "vault_unavailable",
          `The document vault can't be reached. The exercise notice for ${orderId} is pending; your shares are issued.`,
          { order: sealed },
        );
      }
      return sealed;
    }
    if (row.state !== "held" && row.state !== "pending") {
      throw conflict("nothing_to_retry", "There is nothing to retry on this order.");
    }
    await db.query("update exercise_orders set state = 'pending' where id = $1 and state = 'held'", [orderId]);
    const order = await loadOrder(db, orderId);
    if (order === null) throw new Error(`order ${orderId} is missing`);
    const response = await runPayment(order, now);
    await storeResponse(orderId, response);
    if (response.status === 503) {
      const body = response.body as { order: Order };
      throw providerHeld(body.order);
    }
    const latest = await loadOrder(db, orderId);
    if (latest === null) throw new Error(`order ${orderId} is missing`);
    return latest;
  });
}

export async function cancelOrder(orderId: string, now: Date): Promise<Order> {
  return withLock(`order:${orderId}`, async () => {
    const result = await writeWithEvents(async (tx, emit) => {
      const row = await tx.queryOne<OrderRow>(
        `select ${ORDER_COLUMNS} from exercise_orders where id = $1 for update`,
        [orderId],
      );
      if (row === null) throw new Error(`order ${orderId} is missing`);
      if (row.state === "issued" || row.state === "cancelled") {
        throw conflict("order_not_cancellable", `Order ${orderId} was already issued and can't be cancelled.`);
      }
      await tx.query("update exercise_orders set state = 'cancelled' where id = $1", [orderId]);
      const holder = await loadPerson(tx, row.holder_id);
      const windowEnded =
        holder !== null && holder.window_ends_at !== null && now.getTime() >= holder.window_ends_at.getTime();
      if (windowEnded) {
        await tx.query("update grants set cancelled = cancelled + $2 where id = $1", [row.grant_id, row.options]);
        await writeLedgerEntry(tx, {
          at: now,
          holderId: row.holder_id,
          kind: "options_cancelled",
          optionsDelta: -row.options,
          reference: row.grant_id,
        });
        await emitCapTable(emit);
      }
      await emit(
        "order_changed",
        { order_id: row.id, grant_id: row.grant_id, state: "cancelled", options: row.options, reason: "cancelled" },
        grantAudience(row.holder_id),
      );
      const fresh = await loadOrderRow(tx, orderId);
      if (fresh === null) throw new Error(`order ${orderId} is missing`);
      return { order: buildOrder(fresh, await noticeStatusFor(tx, fresh)), paymentId: row.payment_id };
    });
    if (result.paymentId !== null) await cancelPayment(result.paymentId);
    return result.order;
  });
}

