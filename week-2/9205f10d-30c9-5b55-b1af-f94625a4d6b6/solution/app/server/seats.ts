import type { PoolClient } from "pg";
import { many, one, pool, transaction } from "./db.js";
import { fullyStaffedEmail, seatWonEmail } from "./emails.js";
import { ApiError, type ErrorCode, notFound } from "./errors.js";
import type { User } from "./auth.js";
import { type Context, type Router, ok } from "./http.js";
import { flushEmails, queueEmail } from "./mail.js";
import { interpreterCards, projectRequest, projectRequests, readable } from "./projection.js";
import { type RequestRecord, type SeatLabel, addHistory, loadRequest, loadRequests, lockRequest, schedulerEmails } from "./requestStore.js";
import { CLAIMABLE, derivedStatus, eligibleSql, overlapSql } from "./rules.js";

type Refusal = Extract<ErrorCode, "invalid_transition" | "seat_taken" | "credential_invalid" | "schedule_conflict">;

const REFUSAL_MESSAGE: Record<Refusal, string> = {
  invalid_transition: "This job is no longer taking claims.",
  seat_taken: "Another interpreter confirmed this seat first.",
  credential_invalid: "Your credential for this job isn't verified through the job's date.",
  schedule_conflict: "You already hold a seat that overlaps this job.",
};

/** Sets a live request's status from its seats; returns the new status. */
export async function settleStatus(client: PoolClient, requestId: string): Promise<RequestRecord["status"]> {
  const seats = await many<{ confirmed: boolean }>(
    client,
    "SELECT interpreter_id IS NOT NULL AS confirmed FROM seats WHERE request_id = $1",
    [requestId],
  );
  const status = derivedStatus(seats);
  await client.query("UPDATE requests SET status = $2 WHERE id = $1", [requestId, status]);
  return status;
}

/** Queues the "Fully staffed" email to the request's client scheduler. */
export async function noticeFullyStaffed(client: PoolClient, record: RequestRecord): Promise<void> {
  const cards = await interpreterCards(
    client,
    record.seats.flatMap((s) => (s.interpreterId ? [s.interpreterId] : [])),
  );
  const team = record.seats.flatMap((seat) => {
    const card = seat.interpreterId ? cards.get(seat.interpreterId) : undefined;
    return card ? [{ label: seat.label, name: card.row.display_name, badges: card.badges }] : [];
  });
  for (const to of await schedulerEmails(client, record.organisation.id)) {
    await queueEmail(client, fullyStaffedEmail(to, record, team));
  }
}

/** Emails the winner and any confirmed teammate after a won claim. */
async function noticeSeatWon(client: PoolClient, record: RequestRecord, winner: User, wonLabel: SeatLabel): Promise<void> {
  const other = record.seats.find((s) => s.label !== wonLabel);
  const teammate = other?.interpreterId
    ? await one<{ email: string; display_name: string }>(client, "SELECT email, display_name FROM people WHERE id = $1", [other.interpreterId])
    : undefined;
  await queueEmail(
    client,
    seatWonEmail(winner.email, record, wonLabel, other ? { label: other.label, name: teammate?.display_name ?? null } : null),
  );
  if (teammate) {
    await queueEmail(client, seatWonEmail(teammate.email, record, wonLabel, { label: wonLabel, name: winner.displayName }));
  }
}

type ClaimOutcome = { won: Record<string, unknown> } | { refused: Refusal };

async function claim(ctx: Context) {
  const seatId = ctx.params.id ?? "";
  const user = ctx.user;
  const outcome = await transaction(async (client): Promise<ClaimOutcome> => {
    const seatRequest = await one<{ request_id: string }>(client, "SELECT request_id FROM seats WHERE id = $1", [seatId]);
    const record = seatRequest ? await lockRequest(client, seatRequest.request_id) : undefined;
    const seat = record?.seats.find((s) => s.id === seatId);
    const refuse = async (code: Refusal): Promise<ClaimOutcome> => {
      if (record && seat) await addHistory(client, record.id, user.displayName, "claim_lost", `Seat ${seat.label}: ${code}`);
      return { refused: code };
    };
    // A claim on a confirmed seat answers seat_taken ahead of visibility and lifecycle checks.
    if (seat?.interpreterId && user.role === "interpreter") return refuse("seat_taken");
    const visible = readable(user, record);
    if (!seat) throw notFound();
    ctx.allow("interpreter");
    if (!CLAIMABLE.includes(visible.status)) return refuse("invalid_transition");
    // One interpreter's claims run one at a time, so two overlapping seats can never both be won.
    await client.query("SELECT 1 FROM people WHERE id = $1 FOR UPDATE", [user.id]);
    const checks = await one<{ eligible: boolean; overlapping: boolean }>(
      client,
      `SELECT ${eligibleSql("$1", "r")} AS eligible, ${overlapSql("$1", "r")} AS overlapping FROM requests r WHERE r.id = $2`,
      [user.id, visible.id],
    );
    if (!checks?.eligible) return refuse("credential_invalid");
    if (checks.overlapping) return refuse("schedule_conflict");
    ctx.json();
    const taken = await client.query(
      "UPDATE seats SET interpreter_id = $1, confirmed_at = now() WHERE id = $2 AND interpreter_id IS NULL",
      [user.id, seatId],
    );
    if (taken.rowCount === 0) return refuse("seat_taken");
    const status = await settleStatus(client, visible.id);
    await addHistory(client, visible.id, user.displayName, "claim_won", `Seat ${seat.label}`);
    const after = readable(user, await loadRequest(client, visible.id));
    await noticeSeatWon(client, after, user, seat.label);
    if (status === "staffed") await noticeFullyStaffed(client, after);
    const projected = await projectRequest(client, user, after);
    const seatJson = (projected.seats as { id: string }[]).find((s) => s.id === seatId);
    return { won: { seat: seatJson, request: projected } };
  });
  if ("refused" in outcome) throw new ApiError(outcome.refused, REFUSAL_MESSAGE[outcome.refused]);
  flushEmails();
  return ok(outcome.won);
}

async function seatsWithRequests(ctx: Context, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const rows = await many<{ seat_id: string; seat_label: string; request_id: string }>(pool, sql, [ctx.user.id, ...params]);
  const records = await loadRequests(pool, "r.id = ANY($1)", [rows.map((r) => r.request_id)]);
  const projected = await projectRequests(pool, ctx.user, records);
  const byId = new Map(projected.map((p) => [p.id, p]));
  return rows.map((row) => ({ seat_id: row.seat_id, seat_label: row.seat_label, request: byId.get(row.request_id) }));
}

async function openSeats(ctx: Context) {
  ctx.allow("interpreter");
  const seats = await seatsWithRequests(
    ctx,
    `SELECT s.id AS seat_id, s.label AS seat_label, r.id AS request_id
     FROM seats s JOIN requests r ON r.id = s.request_id
     WHERE s.interpreter_id IS NULL AND r.status = ANY($2)
       AND ${eligibleSql("$1", "r")} AND NOT ${overlapSql("$1", "r")}
     ORDER BY r.starts_at, r.reference, s.label`,
    [CLAIMABLE],
  );
  return ok({ open_seats: seats });
}

async function assignments(ctx: Context) {
  ctx.allow("interpreter");
  const seats = await seatsWithRequests(
    ctx,
    `SELECT s.id AS seat_id, s.label AS seat_label, r.id AS request_id
     FROM seats s JOIN requests r ON r.id = s.request_id
     WHERE s.interpreter_id = $1
     ORDER BY r.starts_at, r.reference, s.label`,
  );
  return ok({ assignments: seats });
}

export function registerSeats(router: Router): void {
  router.on("POST", "/api/seats/:id/claim", claim);
  router.on("GET", "/api/open-seats", openSeats);
  router.on("GET", "/api/assignments", assignments);
}
