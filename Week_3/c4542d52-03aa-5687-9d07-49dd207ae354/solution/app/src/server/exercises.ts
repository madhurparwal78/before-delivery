import { createHash } from "node:crypto";
import type { ExerciseOrder, ExerciseOrderState, PaymentRecord, Person } from "../shared/types.js";
import { formatMoney, formatPrice, exerciseCostCents } from "./decimal.js";
import { groupThousands } from "../shared/format.js";
import { direct, nextId, only, query, transaction, type Queryable, type Tx } from "./db.js";
import { ApiError, conflict, forbidden, internalError, notFound, providerUnavailable, replayStored, validation, vaultUnavailable, errorBody } from "./errors.js";
import { createPendingDocument, exerciseNoticeText, sealDocument } from "./documents.js";
import { canSeeGrant, committedTerms, exercisableOf, grantRow, requireHolder, settleGrant, vestingBasis, type GrantRow } from "./grants.js";
import { windowHasEnded } from "./deadlines.js";
import { writeLedgerEntry } from "./ledger.js";
import { cancelPayment, createPayment, fetchPayment, ProviderUnreachable } from "./provider.js";
import { iso, now, pacificDate, sleep } from "./time.js";
import { vestedOn } from "./vesting.js";

type ExerciseOrderRow = {
  id: string;
  grant_id: string;
  holder_id: string;
  options: number;
  strike_units: string;
  cost_cents: string;
  idempotency_key: string;
  fingerprint: string;
  state: ExerciseOrderState;
  placed_at: Date;
  issued_at: Date | null;
  payment: PaymentRecord | null;
  notice_document_id: string | null;
  notice_status: "pending" | "sealed" | null;
  response_status: number | null;
  response_body: unknown;
};

const SELECT_EXERCISE_ORDERS = `SELECT o.id, o.grant_id, o.holder_id, o.options, o.strike_units::text AS strike_units, o.cost_cents::text AS cost_cents,
    o.idempotency_key, o.fingerprint, o.state, o.placed_at, o.issued_at, o.payment, o.notice_document_id, d.status AS notice_status,
    o.response_status, o.response_body
  FROM orders o LEFT JOIN documents d ON d.id = o.notice_document_id`;

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SYNC_WAIT_MS = 5000;
const POLL_EVERY_MS = 2000;
const STORED_RESPONSE_WAIT_MS = 40000;

function presentExerciseOrder(row: ExerciseOrderRow): ExerciseOrder {
  return {
    id: row.id,
    grant_id: row.grant_id,
    holder_id: row.holder_id,
    options: row.options,
    strike: formatPrice(BigInt(row.strike_units)),
    cost: formatMoney(BigInt(row.cost_cents)),
    idempotency_key: row.idempotency_key,
    state: row.state,
    placed_at: iso(row.placed_at),
    issued_at: row.issued_at ? iso(row.issued_at) : null,
    payment: row.payment ? { ...row.payment, confirmed_at: row.payment.confirmed_at ? iso(new Date(row.payment.confirmed_at)) : null } : null,
    notice: row.notice_document_id && row.notice_status ? { document_id: row.notice_document_id, status: row.notice_status } : null,
  };
}

async function exerciseOrderRow(db: Queryable, id: string, lock = false): Promise<ExerciseOrderRow> {
  if (lock) await db.query("SELECT 1 FROM orders WHERE id = $1 FOR UPDATE", [id]);
  const rows = await db.query<ExerciseOrderRow>(`${SELECT_EXERCISE_ORDERS} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function visibleExerciseOrder(person: Person, id: string): Promise<ExerciseOrderRow> {
  const row = await exerciseOrderRow(direct, id);
  if (person.role !== "founder_admin" && row.holder_id !== person.id) throw notFound();
  return row;
}

export async function loadExerciseOrder(person: Person, id: string): Promise<ExerciseOrder> {
  return presentExerciseOrder(await visibleExerciseOrder(person, id));
}

export async function listExerciseOrders(person: Person): Promise<ExerciseOrder[]> {
  if (person.role !== "founder_admin" && person.role !== "option_holder" && person.role !== "leaver") throw forbidden();
  const rows =
    person.role === "founder_admin"
      ? await query<ExerciseOrderRow>(`${SELECT_EXERCISE_ORDERS} ORDER BY o.id DESC`)
      : await query<ExerciseOrderRow>(`${SELECT_EXERCISE_ORDERS} WHERE o.holder_id = $1 ORDER BY o.id DESC`, [person.id]);
  return rows.map(presentExerciseOrder);
}

/** Every order state change goes through here: the state moves only from one of the named states. */
async function moveExerciseOrder(tx: Tx, id: string, from: ExerciseOrderState[], to: ExerciseOrderState, set: Record<string, unknown> = {}): Promise<boolean> {
  const columns = Object.keys(set);
  const assignments = columns.map((column, index) => `, ${column} = $${index + 4}`).join("");
  const rows = await tx.query<{ id: string }>(
    `UPDATE orders SET state = $3${assignments} WHERE id = $1 AND state = ANY($2::text[]) RETURNING id`,
    [id, from, to, ...columns.map((column) => set[column])],
  );
  if (rows.length > 0) tx.emit({ to: null, type: "changed", data: { topics: ["orders", "grants"] } });
  return rows.length > 0;
}

/* ----------------------------------------------------------------- quote */

type Exercisability = { grant: GrantRow; exercisable: number };

function exercisability(row: GrantRow): Exercisability {
  const basis = vestingBasis(row, pacificDate(now()));
  return { grant: row, exercisable: exercisableOf(row, basis ? vestedOn(basis) : 0) };
}

function checkExercisable(row: GrantRow, received: Date): void {
  if (row.state !== "accepted") throw conflict("grant_not_exercisable", "Only an accepted grant can be exercised.");
  if (windowHasEnded(row.window_ends_at, received)) {
    throw conflict("exercise_window_closed", "Your exercise window closed before this order arrived.");
  }
}

function checkOptions(options: unknown, exercisable: number): number {
  if (typeof options !== "number" || !Number.isSafeInteger(options) || options < 1) {
    throw validation({ options: "Enter a whole number of options." });
  }
  if (options > exercisable) throw validation({ options: `Only ${groupThousands(exercisable)} vested options are available to exercise.` });
  return options;
}

export async function quoteExercise(person: Person, grantId: string, options: unknown): Promise<{ options: number; strike: string; cost: string }> {
  await settleGrant(grantId);
  const row = await grantRow(direct, grantId);
  if (!canSeeGrant(person, row)) throw notFound();
  requireHolder(person, row);
  checkExercisable(row, now());
  const count = checkOptions(options, exercisability(row).exercisable);
  const { strikeUnits } = committedTerms(row);
  return { options: count, strike: formatPrice(strikeUnits), cost: formatMoney(exerciseCostCents(count, strikeUnits)) };
}

/* ---------------------------------------------------------------- placing */

const fingerprintOf = (grantId: string, body: Record<string, unknown>): string =>
  createHash("sha256")
    .update(`${grantId}\n${JSON.stringify(body, Object.keys(body).sort())}`)
    .digest("hex");

/** The first answer to an idempotency key, again: the order on success, the refusal through the shared error path. */
function answerStored(status: number, body: unknown): { status: number; body: unknown } {
  if (status >= 400) throw replayStored(status, body as Parameters<typeof replayStored>[1]);
  return { status, body };
}

async function storedResponse(key: string): Promise<{ status: number; body: unknown }> {
  const deadline = now().getTime() + STORED_RESPONSE_WAIT_MS;
  while (now().getTime() < deadline) {
    const [row] = await query<{ response_status: number | null; response_body: unknown }>(
      "SELECT response_status, response_body FROM orders WHERE idempotency_key = $1",
      [key],
    );
    if (row?.response_status) return answerStored(row.response_status, row.response_body);
    await sleep(50);
  }
  throw internalError();
}

async function replayExerciseOrder(person: Person, grantId: string, key: string, fingerprint: string): Promise<{ status: number; body: unknown }> {
  const existing = only(
    await query<{ holder_id: string; grant_id: string; fingerprint: string }>(
      "SELECT holder_id, grant_id, fingerprint FROM orders WHERE idempotency_key = $1",
      [key],
    ),
  );
  if (existing.holder_id !== person.id || existing.grant_id !== grantId || existing.fingerprint !== fingerprint) {
    throw conflict("idempotency_key_reused", "That idempotency key was already used for a different exercise.");
  }
  return storedResponse(key);
}

export async function placeExerciseOrder(
  person: Person,
  grantId: string,
  header: string | undefined,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const received = now();
  const fingerprint = fingerprintOf(grantId, body);
  if (header !== undefined && KEY_PATTERN.test(header)) {
    const [known] = await query("SELECT 1 FROM orders WHERE idempotency_key = $1", [header]);
    if (known) return replayExerciseOrder(person, grantId, header, fingerprint);
  }
  await settleGrant(grantId);
  const preview = await grantRow(direct, grantId);
  if (!canSeeGrant(person, preview)) throw notFound();
  requireHolder(person, preview);
  checkExercisable(preview, received);
  if (header === undefined || !KEY_PATTERN.test(header)) {
    throw validation({ idempotency_key: "Send an Idempotency-Key of 8 to 64 letters, digits, - or _." });
  }
  const key = header;
  let orderId: string | null;
  try {
    orderId = await transaction(async (tx) => {
      const grant = await grantRow(tx, grantId, true);
      // Read under the grant lock, so a request that lost the race for this key never probes the unique index against an order still being updated.
      if ((await tx.query("SELECT 1 FROM orders WHERE idempotency_key = $1", [key])).length > 0) return null;
      checkExercisable(grant, received);
      const { exercisable } = exercisability(grant);
      const options = checkOptions(body.options, exercisable);
      const id = await nextId(tx, "order_number", "EXO-", 6);
      const { strikeUnits } = committedTerms(grant);
      await tx.query(
        `INSERT INTO orders (id, grant_id, holder_id, options, strike_units, cost_cents, idempotency_key, fingerprint, state, placed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
        [id, grantId, person.id, options, strikeUnits.toString(), exerciseCostCents(options, strikeUnits).toString(), key, fingerprint, received],
      );
      tx.emit({ to: null, type: "changed", data: { topics: ["orders", "grants"] } });
      return id;
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") return replayExerciseOrder(person, grantId, key, fingerprint);
    throw error;
  }
  if (orderId === null) return replayExerciseOrder(person, grantId, key, fingerprint);
  await submitPayment(orderId);
  const order = presentExerciseOrder(await exerciseOrderRow(direct, orderId));
  const refusal = order.state === "held" ? providerUnavailable({ order }) : null;
  const status = refusal ? refusal.status : 201;
  const answer = refusal ? errorBody(refusal) : order;
  await query("UPDATE orders SET response_status = $2, response_body = $3::jsonb WHERE id = $1", [orderId, status, JSON.stringify(answer)]);
  if (refusal) throw refusal;
  return { status, body: answer };
}

/* ---------------------------------------------------------------- payment */

/** Sends the payment under the order's key, then waits up to five seconds for the provider's record to confirm it. */
async function submitPayment(orderId: string): Promise<void> {
  const row = await exerciseOrderRow(direct, orderId);
  try {
    const payment = await createPayment({
      id: row.id,
      grantId: row.grant_id,
      options: row.options,
      costCents: BigInt(row.cost_cents),
      key: row.idempotency_key,
    });
    // One statement: a second update of the row inside this transaction would re-check the grant's foreign key and wait on its lock.
    await transaction((tx) =>
      moveExerciseOrder(tx, orderId, ["held", "pending"], "pending", {
        payment: JSON.stringify({ id: payment.id, status: payment.status, amount_cents: payment.amount_cents, currency: payment.currency, reference: payment.reference, confirmed_at: null }),
      }),
    );
  } catch (error) {
    if (!(error instanceof ProviderUnreachable)) throw error;
    await transaction((tx) => moveExerciseOrder(tx, orderId, ["pending", "held"], "held"));
    return;
  }
  await confirmWithRecord(orderId, SYNC_WAIT_MS);
}

/** Fetches the provider's record, again every two seconds while it reads pending, until `waitMs` has passed. */
async function confirmWithRecord(orderId: string, waitMs: number): Promise<void> {
  const deadline = now().getTime() + waitMs;
  for (;;) {
    const row = await exerciseOrderRow(direct, orderId);
    if (row.state !== "pending" || row.payment === null) return;
    let record;
    try {
      record = await fetchPayment(row.payment.id);
    } catch (error) {
      if (error instanceof ProviderUnreachable) return;
      throw error;
    }
    await query("UPDATE orders SET payment = payment || jsonb_build_object('status', $2::text, 'confirmed_at', $3::text), last_polled_at = $4 WHERE id = $1", [
      orderId,
      record.status,
      record.confirmed_at,
      now(),
    ]);
    if (record.status === "confirmed") {
      const matches = BigInt(record.amount_cents) === BigInt(row.cost_cents) && record.reference === row.id;
      if (matches) await issueExerciseOrder(orderId);
      else await transaction((tx) => moveExerciseOrder(tx, orderId, ["pending"], "held"));
      return;
    }
    if (record.status !== "pending") {
      await transaction((tx) => moveExerciseOrder(tx, orderId, ["pending"], "held"));
      return;
    }
    const remaining = deadline - now().getTime();
    if (remaining <= 0) return;
    await sleep(Math.min(POLL_EVERY_MS, remaining));
  }
}

/** Shares are issued here and nowhere else, once, after the provider's record confirmed the order. */
async function issueExerciseOrder(orderId: string): Promise<void> {
  const issued = await transaction(async (tx) => {
    const order = await exerciseOrderRow(tx, orderId, true);
    if (order.state === "cancelled") {
      if (order.payment) tx.afterCommit(() => sendProviderCancel(orderId));
      return false;
    }
    const grant = await grantRow(tx, order.grant_id, true);
    const issuedAt = now();
    if (!(await moveExerciseOrder(tx, orderId, ["pending", "held"], "issued", { issued_at: issuedAt }))) return false;
    await tx.query("UPDATE grants SET exercised = exercised + $2 WHERE id = $1", [grant.id, order.options]);
    await writeLedgerEntry(tx, {
      holderId: order.holder_id,
      kind: "exercise_issued",
      shareClass: "Common",
      sharesDelta: order.options,
      optionsDelta: -order.options,
      reference: order.id,
    });
    const noticeId = await createPendingDocument(tx, {
      kind: "exercise_notice",
      title: `Exercise notice ${order.id}`,
      ownerId: order.holder_id,
      vaultKey: `exercise-notices/${order.id}.txt`,
      text: exerciseNoticeText({
        id: order.id,
        grantId: order.grant_id,
        holderName: committedTerms(grant).holderName,
        options: order.options,
        strike: formatPrice(BigInt(order.strike_units)),
        cost: formatMoney(BigInt(order.cost_cents)),
        paymentId: order.payment?.id ?? "",
        issuedAt,
      }),
    });
    await tx.query("UPDATE orders SET notice_document_id = $2 WHERE id = $1", [orderId, noticeId]);
    tx.emit({ to: order.holder_id, type: "order.issued", data: { order_id: order.id, grant_id: order.grant_id, options: order.options } });
    return true;
  });
  if (issued) await sealNotice(orderId);
}

/** Seals an issued order's notice in the vault; the order stays issued whatever the vault answers. */
async function sealNotice(orderId: string): Promise<"sealed" | "pending"> {
  return transaction(async (tx) => {
    const order = await exerciseOrderRow(tx, orderId);
    if (!order.notice_document_id || order.notice_status === "sealed") return "sealed" as const;
    try {
      await sealDocument(tx, order.notice_document_id);
    } catch (error) {
      if (error instanceof ApiError && error.code === "vault_unavailable") return "pending" as const;
      throw error;
    }
    tx.emit({ to: order.holder_id, type: "order.notice_sealed", data: { order_id: order.id } });
    tx.emit({ to: null, type: "changed", data: { topics: ["orders"] } });
    return "sealed" as const;
  });
}

/* ------------------------------------------------------- retry and cancel */

export async function retryExerciseOrder(person: Person, id: string): Promise<{ status: number; body: unknown }> {
  const row = await visibleExerciseOrder(person, id);
  if (row.holder_id !== person.id) throw forbidden();
  if (row.state === "held") {
    await submitPayment(id);
    const order = presentExerciseOrder(await exerciseOrderRow(direct, id));
    if (order.state === "held") throw providerUnavailable({ order });
    return { status: 200, body: order };
  }
  if (row.state === "issued" && row.notice_status === "pending") {
    const outcome = await sealNotice(id);
    const order = presentExerciseOrder(await exerciseOrderRow(direct, id));
    if (outcome === "pending") throw vaultUnavailable({ order });
    return { status: 200, body: order };
  }
  throw conflict("nothing_to_retry", "There is nothing to retry on this order.");
}

export async function cancelExerciseOrder(person: Person, id: string): Promise<ExerciseOrder> {
  const row = await visibleExerciseOrder(person, id);
  if (row.holder_id !== person.id) throw forbidden();
  await transaction(async (tx) => {
    const order = await exerciseOrderRow(tx, id, true);
    const grant = await grantRow(tx, order.grant_id, true);
    if (!(await moveExerciseOrder(tx, id, ["pending", "held"], "cancelled"))) {
      throw conflict("order_not_cancellable", `Order ${id} was already ${order.state === "issued" ? "issued and can't be cancelled" : "cancelled"}.`);
    }
    if (grant.window_settled) {
      await tx.query("UPDATE grants SET cancelled = cancelled + $2 WHERE id = $1", [grant.id, order.options]);
      await writeLedgerEntry(tx, {
        holderId: order.holder_id,
        kind: "options_cancelled",
        shareClass: null,
        sharesDelta: 0,
        optionsDelta: -order.options,
        reference: order.id,
      });
    }
    if (order.payment) tx.afterCommit(() => sendProviderCancel(id));
  });
  return presentExerciseOrder(await exerciseOrderRow(direct, id));
}

async function sendProviderCancel(orderId: string): Promise<void> {
  const row = await exerciseOrderRow(direct, orderId);
  if (row.state !== "cancelled" || row.payment === null || row.payment.status === "cancelled") return;
  try {
    await cancelPayment(row.payment.id);
  } catch (error) {
    if (error instanceof ProviderUnreachable) return;
    throw error;
  }
  await query("UPDATE orders SET payment = payment || jsonb_build_object('status', 'cancelled') WHERE id = $1", [orderId]);
}

/* --------------------------------------------------------------- scheduler */

/** Fetches the record of every pending order that has not been looked at for two seconds. */
export async function pollPendingExerciseOrders(): Promise<void> {
  const due = await query<{ id: string }>(
    `UPDATE orders SET last_polled_at = $1
      WHERE state = 'pending' AND payment IS NOT NULL AND (last_polled_at IS NULL OR last_polled_at <= $2)
      RETURNING id`,
    [now(), new Date(now().getTime() - POLL_EVERY_MS)],
  );
  await Promise.all(due.map((row) => confirmWithRecord(row.id, 0)));
}

/** Sends again any provider cancel that has not been acknowledged for a cancelled order. */
export async function retryProviderCancels(): Promise<void> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM orders WHERE state = 'cancelled' AND payment IS NOT NULL AND payment ->> 'status' <> 'cancelled'",
  );
  await Promise.all(rows.map((row) => sendProviderCancel(row.id)));
}

