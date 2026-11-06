// Dispatch: the board, the gate dry-run and the pin that creates an offer.
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { BoardInterpreter, DryRun, GateResult, Named } from "../../shared/api.js";
import type { CredentialType } from "../../shared/domain.js";
import { agencyDate } from "../../shared/time.js";
import { audit } from "../audit.js";
import { type Db, one, pool, rows, transaction } from "../db.js";
import { evaluateGates } from "../domain/gates.js";
import { credentialStatus, DISPATCHABLE, derivedStatus, holdingOfferSql, offerExpiry } from "../domain/rules.js";
import { jobOf, offerMail } from "../emails.js";
import { ApiError } from "../errors.js";
import { json, route, type AuthedCtx } from "../http.js";
import { enqueue, kickOutbox } from "../outbox.js";
import { observe, recordExpiredOffers } from "../sweep.js";
import { refOf, REQUEST_SELECT, requestRows, requestView, requestViews, type RequestRow } from "../views.js";
import { idParam, isId } from "./common.js";

route("GET", "/api/board", ["coordinator"], async () => {
  await observe();
  const [people, credentials, found] = await Promise.all([
    rows<{ id: string; name: string }>(pool, "SELECT id, name FROM users WHERE role = 'interpreter' ORDER BY name"),
    rows<{ id: string; interpreter_id: string; type: CredentialType; expires_on: string }>(
      pool,
      "SELECT id, interpreter_id, type, expires_on FROM credentials ORDER BY type, expires_on DESC",
    ),
    requestRows(
      pool,
      "r.start_at >= now() AND r.start_at < now() + interval '72 hours' AND r.status NOT IN ('cancelled_on_time', 'cancelled_late')",
      [],
    ),
  ]);
  const today = agencyDate(new Date());
  const interpreters: BoardInterpreter[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    credentials: credentials
      .filter((c) => c.interpreter_id === p.id)
      .map((c) => ({ id: c.id, type: c.type, expires_on: c.expires_on, expired: credentialStatus(c.expires_on, today) === "expired" })),
  }));
  return json(200, { interpreters, requests: await requestViews(pool, found) });
});

interface SeatContext {
  seatId: string;
  position: number;
  request: RequestRow;
  interpreter: Named & { email: string };
}

/**
 * The checks dry-run and pin share, in the brief's order: unknown seat or interpreter, seat
 * taken, request not open to dispatch. A pin passes its transaction to take the row locks
 * (interpreter, then request) that serialise racing pins.
 */
async function seatContext(db: Db, seatId: string, interpreterId: unknown, lock: PoolClient | null): Promise<SeatContext> {
  if (!isId(interpreterId)) throw new ApiError("not_found");
  const interpreter = await one<Named & { email: string }>(
    db,
    `SELECT id, name, email FROM users WHERE id = $1 AND role = 'interpreter'${lock ? " FOR UPDATE" : ""}`,
    [interpreterId],
  );
  const seat = await one<{ request_id: string; position: number }>(db, "SELECT request_id, position FROM seats WHERE id = $1", [seatId]);
  if (!interpreter || !seat) throw new ApiError("not_found");
  const request = await one<RequestRow>(db, `${REQUEST_SELECT} WHERE r.id = $1${lock ? " FOR UPDATE OF r" : ""}`, [seat.request_id]);
  if (!request) throw new ApiError("not_found");
  // An offer past its expiry no longer holds the seat; a pin records that before the seat is judged.
  if (lock) await recordExpiredOffers(lock, seatId);
  const holder = await one<Named>(
    db,
    `SELECT h.id, h.name FROM offers o JOIN users h ON h.id = o.held_by
     WHERE o.seat_id = $1 AND ${holdingOfferSql()}`,
    [seatId],
  );
  if (holder) throw new ApiError("seat_taken", { holder });
  const status = derivedStatus(request.status, request.end_at, new Date());
  if (!DISPATCHABLE.includes(status)) throw new ApiError("invalid_transition", { from: status });
  return { seatId, position: seat.position, request, interpreter };
}

/** Everything the four gates read, as it stands in `db` right now. */
async function gates(db: Db, ctx: SeatContext): Promise<GateResult[]> {
  const [credentials, commitments, blocked] = await Promise.all([
    rows<{ type: CredentialType; expires_on: string }>(db, "SELECT type, expires_on FROM credentials WHERE interpreter_id = $1", [ctx.interpreter.id]),
    rows<{ ref_no: number; start_at: Date; end_at: Date }>(
      db,
      `SELECT r.ref_no, r.start_at, r.end_at FROM offers o JOIN seats s ON s.id = o.seat_id JOIN requests r ON r.id = s.request_id
       WHERE o.interpreter_id = $1 AND s.id <> $2
         AND ${holdingOfferSql()}
         AND r.status NOT IN ('cancelled_on_time', 'cancelled_late')
       ORDER BY r.start_at`,
      [ctx.interpreter.id, ctx.seatId],
    ),
    one(db, "SELECT 1 FROM preferences WHERE consumer_id = $1 AND interpreter_id = $2 AND kind = 'blocked'", [ctx.request.consumer_id, ctx.interpreter.id]),
  ]);
  return evaluateGates({
    setting: ctx.request.setting,
    start: ctx.request.start_at,
    end: ctx.request.end_at,
    consumerName: ctx.request.consumer_name,
    blockedByConsumer: blocked !== undefined,
    credentials: credentials.map((c) => ({ type: c.type, expiresOn: c.expires_on })),
    commitments: commitments.map((c) => ({ ref: refOf(c.ref_no), start: c.start_at, end: c.end_at })),
  });
}

route("POST", "/api/seats/:id/dry-run", ["coordinator"], async (ctx) => {
  const context = await seatContext(pool, idParam(ctx, "id"), ctx.body.interpreter_id, null);
  const results = await gates(pool, context);
  const body: DryRun = { seat_id: context.seatId, interpreter_id: context.interpreter.id, gates: results, all_pass: results.every((g) => g.pass) };
  return json(200, body);
});

async function pin(ctx: AuthedCtx): Promise<{ requestId: string; seatId: string; offerId: string }> {
  const seatId = idParam(ctx, "id");
  return transaction(async (client) => {
    const context = await seatContext(client, seatId, ctx.body.interpreter_id, client);
    const now = new Date();
    const expiresAt = offerExpiry(now, context.request.start_at, context.request.logged_after);
    if (expiresAt.getTime() <= now.getTime()) throw new ApiError("offer_window_closed");
    const results = await gates(client, context);
    const failed = results.find((g) => !g.pass);
    if (failed) throw new ApiError("gate_failed", { gate: failed.gate, gates: results }, `Not offered. ${failed.reason}`);
    const total = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM seats WHERE request_id = $1", [context.request.id]);
    const token = randomBytes(32).toString("base64url");
    const offerId = randomUUID();
    const outboxId = await enqueue(
      client,
      offerMail(context.interpreter.email, jobOf(context.request), { position: context.position, total: total?.n ?? 1 }, expiresAt, token),
    );
    await client.query(
      `INSERT INTO offers (id, seat_id, interpreter_id, held_by, token, status, sent_at, expires_at, outbox_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)`,
      [offerId, seatId, context.interpreter.id, ctx.user.id, token, now, expiresAt, outboxId],
    );
    await audit(client, {
      actorId: ctx.user.id,
      action: "seat.offered",
      entity: "seat",
      entityId: seatId,
      requestId: context.request.id,
      from: "open",
      to: "offered",
      detail: { offer_id: offerId, interpreter: { id: context.interpreter.id, name: context.interpreter.name }, expires_at: expiresAt.toISOString() },
    });
    return { requestId: context.request.id, seatId, offerId };
  });
}

route("POST", "/api/seats/:id/offers", ["coordinator"], async (ctx) => {
  const made = await pin(ctx);
  kickOutbox();
  const request = await requestView(pool, made.requestId);
  const seat = request?.seats.find((s) => s.id === made.seatId);
  if (!request || !seat?.offer) throw new ApiError("internal");
  return json(201, { offer: seat.offer, seat, request });
});
