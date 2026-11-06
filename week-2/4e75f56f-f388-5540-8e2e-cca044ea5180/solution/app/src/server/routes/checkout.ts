import { BUYER_ROLES, buyerDisplayName, type Account } from "../auth.js";
import { lockLedger, one, tx, type Db } from "../db.js";
import { conflict, notFound, validation } from "../http.js";
import { KEY_ERROR, keyIsValid, refuseReuse, replayOf } from "../idempotency.js";
import { currentInventory } from "../ledger.js";
import { charge, kbBuyer, settle, type PaymentKind } from "../payments.js";
import {
  balanceCents,
  lockReservations,
  lockedVisible,
  reload,
  reservationView,
  reservationsWhere,
  type ReservationRow,
} from "../reservations.js";
import { PRICES, depositsOpen, isBenchLabel, tierOf, upgradeCharge, venueToday } from "../rules.js";
import { route, type Ctx, type Result } from "../router.js";
import { email, fields, text } from "../validate.js";
import { groupView } from "../views.js";
import { attendsASeat } from "./reservations.js";

/** Idempotency under the seat lock: a concurrent replay returns the stored answer, a reused key is refused. */
async function replayOrRefuse(db: Db, ctx: Ctx): Promise<Result | null> {
  if (keyIsValid(ctx.idempotencyKey)) {
    const replay = await replayOf(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
    if (replay) return { status: replay.status, body: replay.body };
  }
  await refuseReuse(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
  return null;
}

/** The 422 checks every payment shares: the Idempotency-Key header and billing_name. */
function paymentErrors(ctx: Ctx): { billingName: string | null; errors: Record<string, string> } {
  const billingName = text(fields(ctx.body).billing_name, 1, 120);
  const errors: Record<string, string> = {};
  if (!keyIsValid(ctx.idempotencyKey)) Object.assign(errors, KEY_ERROR);
  if (!billingName) errors.billing_name = "Enter the name for the receipt (1 to 120 characters).";
  return { billingName, errors };
}

function billingNameOrRefuse(ctx: Ctx, extra: Record<string, string> = {}): string {
  const { billingName, errors } = paymentErrors(ctx);
  if (!billingName || Object.keys(errors).length || Object.keys(extra).length) throw validation({ ...errors, ...extra });
  return billingName;
}

function holdLapsed(row: ReservationRow, now: Date): boolean {
  return row.state === "released" || (row.state === "held" && !row.payment_pending && (row.hold_expires_at?.getTime() ?? 0) <= now.getTime());
}

function seatCheck(kind: "deposit" | "full" | "balance", row: ReservationRow, ctx: Ctx): void {
  if (row.payment_pending && row.payment_pending !== kind) throw conflict("invalid_transition", "Another payment for this seat is being confirmed.");
  if (row.group_id) throw conflict("invalid_transition", "Group seats are paid on the group invoice.");
  if (kind === "balance") {
    if (row.state === "deposit_paid") return;
    if (["paid_in_full", "checked_in_day1", "checked_in_day2", "certificate_issued"].includes(row.state)) {
      throw conflict("already_paid", "This seat is already paid in full.");
    }
    throw conflict("not_deposit_paid", "The balance is due once the deposit is paid.");
  }
  if (row.state !== "held") {
    if (holdLapsed(row, ctx.now)) throw conflict("hold_expired", "This hold has ended.");
    if (row.state === "cancelled" || row.state === "refunded") throw conflict("invalid_transition", "This seat was cancelled.");
    throw conflict("already_paid", "This seat is already paid.");
  }
  if (holdLapsed(row, ctx.now)) throw conflict("hold_expired", "This hold has ended.");
  if (kind === "deposit" && !depositsOpen(venueToday(ctx.now))) {
    throw conflict("deposits_closed", "Deposits closed on 19 March 2027. Pay in full to reserve a bench.");
  }
}

function amountFor(kind: "deposit" | "full" | "balance", row: ReservationRow): number {
  if (kind === "balance") return balanceCents(row);
  return kind === "deposit" ? PRICES[tierOf(row.bench)].deposit : PRICES[tierOf(row.bench)].full;
}

async function payOne(db: Db, ctx: Ctx, kind: PaymentKind, row: ReservationRow, bench: string, amountCents: number, billingName: string): Promise<Result> {
  const payment = await charge(db, { kind, ownerId: row.id, buyer: kbBuyer(row), billingName, items: [{ reservationId: row.id, bench, amountCents }] });
  const done = await settle(db, payment, ctx.now);
  return { status: done ? 201 : 202, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
}

function seatPayment(kind: "deposit" | "full" | "balance") {
  route({
    method: "POST",
    path: `/api/reservations/:id/${kind}`,
    access: BUYER_ROLES,
    idempotent: true,
    handle: (ctx) =>
      tx(async (db) => {
        const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
        const replay = await replayOrRefuse(db, ctx);
        if (replay) return replay;
        seatCheck(kind, row, ctx);
        const billingName = billingNameOrRefuse(ctx);
        return payOne(db, ctx, kind, row, row.bench, amountFor(kind, row), billingName);
      }),
  });
}

seatPayment("deposit");
seatPayment("full");
seatPayment("balance");

route({
  method: "POST",
  path: "/api/reservations/:id/upgrade",
  access: BUYER_ROLES,
  idempotent: true,
  handle: (ctx) =>
    tx(async (db) => {
      await lockLedger(db);
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
      const replay = await replayOrRefuse(db, ctx);
      if (replay) return replay;
      if (row.state !== "deposit_paid" && row.state !== "paid_in_full") throw conflict("not_paid", "Upgrades are for paid seats.");
      if (tierOf(row.bench) === "atelier") throw conflict("already_atelier", "This seat is already an Atelier bench.");
      const target = fields(ctx.body).bench;
      const atelierTarget = isBenchLabel(target) && tierOf(target) === "atelier" ? target : null;
      if (atelierTarget) {
        if (row.upgrade_target && row.upgrade_target !== atelierTarget) throw conflict("invalid_transition", "Another upgrade is being confirmed.");
        if (row.upgrade_target !== atelierTarget) {
          const stock = await currentInventory(db);
          if (stock.occupied.has(atelierTarget)) throw conflict("bench_taken", `Bench ${atelierTarget} was just taken.`);
          if (stock.atelier.soldOut) throw conflict("atelier_sold_out", "Atelier is sold out.");
        }
      }
      if (!atelierTarget) throw validation({ ...paymentErrors(ctx).errors, bench: "Choose an open Atelier bench in row A or B." });
      const billingName = billingNameOrRefuse(ctx);
      await db.query("UPDATE reservations SET upgrade_target = $2 WHERE id = $1", [row.id, atelierTarget]);
      return payOne(db, ctx, "upgrade", row, atelierTarget, upgradeCharge(row.state, depositsOpen(venueToday(ctx.now))), billingName);
    }),
});

interface Assignment {
  bench: string;
  name: string;
  email: string;
}

async function groupSeats(db: Db, groupId: string, account: Account): Promise<ReservationRow[]> {
  const group = await one<{ buyer_id: string }>(db, "SELECT buyer_id FROM groups WHERE id = $1", [groupId]);
  if (!group || group.buyer_id !== account.id) throw notFound();
  const ids = (await reservationsWhere(db, "r.group_id = $1", [groupId])).map((row) => row.id);
  await lockReservations(db, ids);
  return reservationsWhere(db, "r.group_id = $1", [groupId]);
}

route({
  method: "POST",
  path: "/api/groups/:id/checkout",
  access: BUYER_ROLES,
  idempotent: true,
  handle: (ctx) =>
    tx(async (db) => {
      const groupId = ctx.params.id ?? "";
      const seats = await groupSeats(db, groupId, ctx.account);
      const replay = await replayOrRefuse(db, ctx);
      if (replay) return replay;
      if (seats.some((seat) => seat.payment_pending && seat.payment_pending !== "group")) {
        throw conflict("invalid_transition", "Another payment for these seats is being confirmed.");
      }
      if (seats.some((seat) => seat.state !== "held" && seat.state !== "released")) throw conflict("already_paid", "This group invoice is already paid.");
      if (seats.some((seat) => holdLapsed(seat, ctx.now))) throw conflict("hold_expired", "This group hold has ended.");
      const raw = fields(ctx.body).assignments;
      const listed = raw === undefined ? [] : Array.isArray(raw) ? raw.map(fields) : null;
      const assignments: Assignment[] = [];
      let assignmentsValid = listed !== null;
      for (const entry of listed ?? []) {
        const bench = typeof entry.bench === "string" ? entry.bench : "";
        const name = text(entry.name, 1, 120);
        const address = email(entry.email);
        if (!seats.some((seat) => seat.bench === bench) || !name || !address || assignments.some((a) => a.bench === bench)) {
          assignmentsValid = false;
          continue;
        }
        const invitee = await one<{ id: string }>(db, "SELECT id FROM accounts WHERE email_key = $1", [address.toLowerCase()]);
        if (invitee && (await attendsASeat(db, invitee.id))) throw conflict("already_attending", `${address} already attends another seat.`);
        assignments.push({ bench, name, email: address });
      }
      const billingName = billingNameOrRefuse(ctx, assignmentsValid ? {} : { assignments: "Each colleague needs a bench from this group, a name and a valid email." });
      const payment = await charge(db, {
        kind: "group",
        ownerId: groupId,
        buyer: { id: ctx.account.id, name: buyerDisplayName(ctx.account.role, ctx.account.name, ctx.account.clinic_name), email: ctx.account.email },
        billingName,
        items: seats.map((seat) => ({ reservationId: seat.id, bench: seat.bench, amountCents: PRICES[tierOf(seat.bench)].full })),
      });
      for (const assignment of assignments) {
        await db.query(
          "UPDATE reservations SET attendee_name = $3, attendee_email = $4, attendee_accepted = false, attendee_account_id = NULL WHERE group_id = $1 AND bench = $2",
          [groupId, assignment.bench, assignment.name, assignment.email],
        );
      }
      const done = await settle(db, payment, ctx.now);
      return { status: done ? 201 : 202, body: { group: await groupView(db, groupId, ctx.now) } };
    }),
});
