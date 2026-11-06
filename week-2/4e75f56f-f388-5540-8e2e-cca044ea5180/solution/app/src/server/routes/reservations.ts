import { BUYER_ROLES, type Account } from "../auth.js";
import { lockLedger, one, pool, tx, type Db } from "../db.js";
import { conflict, notFound, validation } from "../http.js";
import { currentInventory, offerFreedBenches, sweep, tierRemaining, waitlistPosition } from "../ledger.js";
import { queueAssignmentMail } from "../payments.js";
import {
  lockReservations,
  lockedVisible,
  newId,
  reload,
  reservationView,
  reservationsWhere,
  transition,
  visibleReservation,
  type ReservationRow,
} from "../reservations.js";
import {
  ACTIVE_STATES,
  MAX_GROUP_BENCHES,
  SOLD_STATES,
  TIER_NAME,
  assertMove,
  atelierRoom,
  isBenchLabel,
  refundDue,
  tierOf,
  venueToday,
} from "../rules.js";
import { route } from "../router.js";
import { config } from "../config.js";
import { email, fields, text } from "../validate.js";
import { freshLedger, groupView } from "../views.js";
import { deleteObject } from "../s3.js";

/** A practitioner attends at most one seat: their own active reservation or one accepted assignment. */
export async function attendsASeat(db: Db, accountId: string, except: string | null = null): Promise<boolean> {
  const found = await one<{ yes: boolean }>(
    db,
    `SELECT EXISTS (SELECT 1 FROM reservations WHERE state = ANY($2) AND attendee_accepted AND attendee_account_id = $1
                    AND id IS DISTINCT FROM $3) AS yes`,
    [accountId, ACTIVE_STATES, except],
  );
  return found?.yes ?? false;
}

async function alreadyReserved(db: Db, account: Account): Promise<boolean> {
  const found = await one<{ yes: boolean }>(
    db,
    `SELECT EXISTS (SELECT 1 FROM reservations WHERE buyer_id = $1 AND state = ANY($2))
         OR EXISTS (SELECT 1 FROM waitlist_entries WHERE account_id = $1 AND state IN ('waitlisted', 'offered')) AS yes`,
    [account.id, ACTIVE_STATES],
  );
  return (found?.yes ?? false) || (await attendsASeat(db, account.id));
}

async function insertHolds(db: Db, account: Account, labels: readonly string[], groupId: string | null, now: Date): Promise<string[]> {
  const expires = new Date(now.getTime() + config.holdSeconds * 1000);
  const practitioner = account.role === "practitioner";
  const ids: string[] = [];
  for (const bench of labels) {
    const id = newId("res");
    await db.query(
      `INSERT INTO reservations (id, bench, state, group_id, buyer_id, attendee_name, attendee_email, attendee_account_id,
                                 attendee_accepted, hold_expires_at, hold_duration)
       VALUES ($1, $2, 'held', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        bench,
        groupId,
        account.id,
        practitioner ? account.name : null,
        practitioner ? account.email : null,
        practitioner ? account.id : null,
        practitioner,
        expires,
        config.holdSeconds,
      ],
    );
    ids.push(id);
  }
  return ids;
}

route({
  method: "POST",
  path: "/api/holds",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      const { account, now } = ctx;
      await lockLedger(db);
      await sweep(db, now);
      const raw = fields(ctx.body).benches;
      const requested = Array.isArray(raw) ? raw : null;
      const labels = [...new Set((requested ?? []).filter(isBenchLabel))];
      if (account.role === "practitioner" && (await alreadyReserved(db, account))) {
        throw conflict("already_reserved", "You already have a bench, an offer or a waitlist place.");
      }
      if (account.role === "clinic") {
        const live = await one(db, "SELECT 1 FROM reservations WHERE buyer_id = $1 AND state = 'held' AND group_id IS NOT NULL", [account.id]);
        if (live) throw conflict("hold_limit", "Your clinic already has a live group hold.");
      }
      const stock = await currentInventory(db);
      const taken = labels.find((label) => stock.occupied.has(label));
      if (taken) {
        const tier = tierOf(taken);
        throw conflict("bench_taken", `Bench ${taken} was just taken.`, { waitlist: { tier, open: tierRemaining(stock, tier) === 0 } });
      }
      const atelierWanted = labels.filter((label) => tierOf(label) === "atelier").length;
      if (atelierWanted > atelierRoom(stock.atelier.active)) {
        throw conflict("atelier_sold_out", "Atelier is sold out.", { waitlist: { tier: "atelier", open: stock.atelier.remaining === 0 } });
      }
      const most = account.role === "practitioner" ? 1 : MAX_GROUP_BENCHES;
      if (!requested || requested.length === 0 || labels.length !== requested.length || requested.length > most) {
        throw validation({ benches: `Choose 1 to ${most} different benches from A1 to D6.` });
      }
      const groupId = account.role === "clinic" ? newId("grp") : null;
      if (groupId) await db.query("INSERT INTO groups (id, buyer_id) VALUES ($1, $2)", [groupId, account.id]);
      const ids = await insertHolds(db, account, labels, groupId, now);
      const rows = await reservationsWhere(db, "r.id = ANY($1)", [ids]);
      return {
        status: 201,
        body: {
          reservations: rows.map((row) => reservationView(row, now)),
          group_id: groupId,
          seats_remaining: (await currentInventory(db)).seatsRemaining,
          server_time: now.toISOString(),
        },
      };
    }),
});

async function releaseRows(db: Db, rows: readonly ReservationRow[], now: Date): Promise<void> {
  if (rows.some((row) => row.payment_pending)) throw conflict("invalid_transition", "This payment is being confirmed.");
  await transition(db, rows, "released", { hold_expires_at: null });
  await offerFreedBenches(db, now, rows.map((row) => row.bench));
}

route({
  method: "POST",
  path: "/api/reservations/:id/release",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      await lockLedger(db);
      await sweep(db, ctx.now);
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
      if (row.group_id) throw conflict("invalid_transition", "Group benches are released together.");
      await releaseRows(db, [row], ctx.now);
      return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now), seats_remaining: (await currentInventory(db)).seatsRemaining } };
    }),
});

async function ownedGroup(db: Db, groupId: string, account: Account): Promise<ReservationRow[]> {
  const group = await one<{ buyer_id: string }>(db, "SELECT buyer_id FROM groups WHERE id = $1", [groupId]);
  if (!group || (group.buyer_id !== account.id && account.role !== "registrar")) throw notFound();
  return reservationsWhere(db, "r.group_id = $1", [groupId]);
}

route({
  method: "POST",
  path: "/api/groups/:id/release",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      await lockLedger(db);
      await sweep(db, ctx.now);
      const groupId = ctx.params.id ?? "";
      const seats = await ownedGroup(db, groupId, ctx.account);
      await lockReservations(db, seats.map((seat) => seat.id));
      await releaseRows(db, await reservationsWhere(db, "r.group_id = $1", [groupId]), ctx.now);
      return { status: 200, body: { group: await groupView(db, groupId, ctx.now), seats_remaining: (await currentInventory(db)).seatsRemaining } };
    }),
});

route({
  method: "GET",
  path: "/api/reservations/:id",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, ["buyer", "attendee", "registrar"]);
    return { status: 200, body: { reservation: reservationView(row, ctx.now), server_time: ctx.now.toISOString() } };
  },
});

route({
  method: "GET",
  path: "/api/groups/:id",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    return tx(async (db) => {
      const groupId = ctx.params.id ?? "";
      await ownedGroup(db, groupId, ctx.account);
      return { status: 200, body: { group: await groupView(db, groupId, ctx.now) } };
    });
  },
});

route({
  method: "POST",
  path: "/api/reservations/:id/cancel",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      await lockLedger(db);
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
      assertMove(row.state, "cancelled");
      const due = refundDue(row.purchased_cents, venueToday(ctx.now));
      if (due === null) throw conflict("no_refund_window", "Refunds closed on 19 March 2027.");
      await transition(db, [row], "cancelled", { refund_due_cents: due });
      await offerFreedBenches(db, ctx.now, [row.bench]);
      return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
    }),
});

// ---- Waitlist and offers ---------------------------------------------------------------------

route({
  method: "POST",
  path: "/api/waitlist",
  access: ["practitioner"],
  handle: (ctx) =>
    tx(async (db) => {
      await lockLedger(db);
      await sweep(db, ctx.now);
      const tier = fields(ctx.body).tier;
      if (await alreadyReserved(db, ctx.account)) throw conflict("already_reserved", "You already have a bench, an offer or a waitlist place.");
      if (tier !== "bench" && tier !== "atelier") throw validation({ tier: "Choose the Bench or Atelier waitlist." });
      if (tierRemaining(await currentInventory(db), tier) > 0) {
        throw conflict("benches_available", `${TIER_NAME[tier]} benches are open; hold one instead.`);
      }
      const id = newId("off");
      await db.query("INSERT INTO waitlist_entries (id, account_id, tier, state) VALUES ($1, $2, $3, 'waitlisted')", [id, ctx.account.id, tier]);
      return { status: 201, body: { tier, position: await waitlistPosition(db, id) } };
    }),
});

route({
  method: "DELETE",
  path: "/api/waitlist",
  access: ["practitioner"],
  handle: async (ctx) => {
    await pool.query("DELETE FROM waitlist_entries WHERE account_id = $1 AND state = 'waitlisted'", [ctx.account.id]);
    return { status: 204 };
  },
});

interface OfferRow {
  id: string;
  account_id: string;
  tier: "bench" | "atelier";
  state: string;
  bench: string | null;
  offer_expires_at: Date | null;
}

async function offeredTo(db: Db, offerId: string, account: Account): Promise<OfferRow> {
  const offer = await one<OfferRow>(db, "SELECT * FROM waitlist_entries WHERE id = $1 AND bench IS NOT NULL FOR UPDATE", [offerId]);
  if (!offer || offer.account_id !== account.id) throw notFound();
  return offer;
}

function offerView(offer: OfferRow, now: Date) {
  return {
    id: offer.id,
    bench: offer.bench,
    tier: offer.tier,
    state: offer.state,
    seconds_remaining:
      offer.state === "offered" && offer.offer_expires_at ? Math.max(0, Math.ceil((offer.offer_expires_at.getTime() - now.getTime()) / 1000)) : 0,
  };
}

route({
  method: "POST",
  path: "/api/offers/:id/accept",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      await lockLedger(db);
      await sweep(db, ctx.now);
      const offer = await offeredTo(db, ctx.params.id ?? "", ctx.account);
      if (offer.state !== "offered" || !offer.bench) throw conflict("offer_lapsed", "This offer has passed to the next person on the waitlist.");
      await db.query("UPDATE waitlist_entries SET state = 'held' WHERE id = $1", [offer.id]);
      const ids = await insertHolds(db, ctx.account, [offer.bench], null, ctx.now);
      const rows = await reservationsWhere(db, "r.id = ANY($1)", [ids]);
      return {
        status: 201,
        body: {
          reservations: rows.map((row) => reservationView(row, ctx.now)),
          seats_remaining: (await currentInventory(db)).seatsRemaining,
          server_time: ctx.now.toISOString(),
        },
      };
    }),
});

route({
  method: "POST",
  path: "/api/offers/:id/decline",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      await lockLedger(db);
      await sweep(db, ctx.now);
      const offer = await offeredTo(db, ctx.params.id ?? "", ctx.account);
      if (offer.state !== "offered" || !offer.bench) throw conflict("offer_lapsed", "This offer has already passed on.");
      await db.query("UPDATE waitlist_entries SET state = 'offer_lapsed' WHERE id = $1", [offer.id]);
      await offerFreedBenches(db, ctx.now, [offer.bench]);
      return { status: 200, body: { offer: offerView({ ...offer, state: "offer_lapsed" }, ctx.now) } };
    }),
});

// ---- Assignment ------------------------------------------------------------------------------

route({
  method: "PUT",
  path: "/api/reservations/:id/assignee",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
      const body = fields(ctx.body);
      const name = text(body.name, 1, 120);
      const address = email(body.email);
      if (row.state !== "deposit_paid" && row.state !== "paid_in_full") {
        throw conflict("invalid_transition", "Seats can be assigned once paid and until day 1 check-in.");
      }
      if (address) {
        const invitee = await one<{ id: string }>(db, "SELECT id FROM accounts WHERE email_key = $1", [address.toLowerCase()]);
        if (invitee && (await attendsASeat(db, invitee.id, row.id))) throw conflict("already_attending", "That person already attends another seat.");
      }
      if (!name || !address) {
        throw validation({ ...(name ? {} : { name: "Enter the colleague's name." }), ...(address ? {} : { email: "Enter a valid email address." }) });
      }
      if (row.attendee_email?.toLowerCase() === address.toLowerCase()) {
        await db.query("UPDATE reservations SET attendee_name = $2 WHERE id = $1", [row.id, name]);
        await queueAssignmentMail(db, row, address);
        return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
      }
      await db.query(
        `UPDATE reservations SET attendee_name = $2, attendee_email = $3, attendee_account_id = NULL, attendee_accepted = false,
           licence_number = NULL, licence_state = NULL, licence_key = NULL, licence_status = 'none',
           passport_full_name = NULL, passport_nationality = NULL, passport_number = NULL, passport_key = NULL
         WHERE id = $1`,
        [row.id, name, address],
      );
      const visaLetter = await one<{ object_key: string }>(db, "DELETE FROM documents WHERE owner_id = $1 AND kind = 'visa-letter' RETURNING object_key", [row.id]);
      await queueAssignmentMail(db, row, address);
      // The former assignee's files go last: if storage refuses, the whole change rolls back with a 503.
      for (const key of [row.licence_key, row.passport_key, visaLetter?.object_key]) {
        if (key) await deleteObject(key);
      }
      return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
    }),
});

route({
  method: "POST",
  path: "/api/reservations/:id/accept",
  access: BUYER_ROLES,
  handle: (ctx) =>
    tx(async (db) => {
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["assignee"]);
      if (!SOLD_STATES.includes(row.state)) throw conflict("invalid_transition", "This seat can no longer be accepted.");
      if (await attendsASeat(db, ctx.account.id, row.id)) throw conflict("already_attending", "You already attend another seat.");
      await db.query("UPDATE reservations SET attendee_account_id = $2, attendee_accepted = true WHERE id = $1", [row.id, ctx.account.id]);
      return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
    }),
});
