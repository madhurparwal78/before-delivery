// Bookings: all-or-nothing creation, reads and e-ticket downloads (brief: DP-25, DP-26, DP-32, DP-33).
import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import type { Accept, BerthPreference, BookingSummary, ClassCode, Gender, Quota } from "../../shared/api.js";
import type { App } from "../app.js";
import { type AllotRefusal, allot } from "../domain/allot.js";
import { findTrain, isStation, stretchOf } from "../domain/catalog.js";
import { isIsoDate, istTimestamp } from "../domain/clock.js";
import { fareQuote, passengerFare } from "../domain/fare.js";
import { cloneRun } from "../domain/run.js";
import { chartAt, opensAt, windowOf } from "../domain/schedule.js";
import { describe } from "../domain/status.js";
import { isAccept, isClass, isPhone, isQuota, journeyErrors, partyErrors } from "../domain/validate.js";
import type { Route } from "../http/api.js";
import { ApiError, assertValid, notFound } from "../http/errors.js";
import { type AccountRow, owner } from "../http/session.js";
import { ProviderUnavailable } from "../services/errors.js";
import { killBillAccount } from "../store/accounts.js";
import { queueMail } from "../store/outbox.js";
import { type BookingRow, bookingRow, ownedBookingRow, passengerRows } from "../store/rows.js";
import { loadRun, lockRun } from "../store/runs.js";
import { reserveTicket, storeTicket, ticketKey } from "../store/tickets.js";
import { bookingBody, currentStatus, stateOf, timelineOf } from "../store/view.js";
import { generalListFor } from "./journeys.js";

const REFUSALS: Record<AllotRefusal, string> = {
  quota_full: "Not enough berths of this quota are left.",
  waitlist_full: "The waiting list for this train is full.",
  party_split: "The party could not be kept in one coach.",
  no_lower_berth: "No lower berth could be allotted.",
  availability_changed: "Availability changed before payment.",
};

interface PassengerInput {
  name: string;
  age: number;
  gender: Gender;
  berth_preference: BerthPreference;
}

interface BookingInput {
  train: string;
  run_date: string;
  from: string;
  to: string;
  class: ClassCode;
  quota: Quota;
  passengers: PassengerInput[];
  keep_in_one_coach: boolean;
  lower_berth_only: boolean;
  accept: Accept;
  contact_phone: string;
}

async function freshPnr(client: PoolClient): Promise<string> {
  for (;;) {
    const pnr = String(randomInt(1_000_000_000, 10_000_000_000));
    const taken = await client.query("SELECT 1 FROM bookings WHERE pnr = $1", [pnr]);
    if (taken.rowCount === 0) return pnr;
  }
}

/** Checks in the brief's precedence: unknown train or station, then the window, then the fields. */
function parseBooking(app: App, body: Record<string, unknown>, now: number): BookingInput {
  const train = findTrain(app.catalog, body.train);
  if (!train || !isStation(app.catalog, body.from) || !isStation(app.catalog, body.to)) throw notFound();
  if (isIsoDate(body.run_date) && isQuota(body.quota) && isClass(body.class)) {
    const opening = opensAt(body.quota, body.class, body.run_date);
    const window = windowOf(now, opening, chartAt(train, body.run_date));
    if (window === "chart_prepared") {
      throw new ApiError(409, "chart_prepared", "The chart for this train is prepared. Bookings are closed.");
    }
    if (window === "not_yet_open") {
      const tatkal = body.quota === "TQ";
      throw new ApiError(409, tatkal ? "tatkal_not_open" : "booking_not_open",
        tatkal ? "Tatkal booking for this train is not open yet." : "Bookings for this train are not open yet.",
        { opens_at: istTimestamp(opening) });
    }
  }
  const errors = { ...journeyErrors(body, "run_date"), ...partyErrors(body.passengers, body.quota) };
  if (!errors.to && !stretchOf(train, body.from as string, body.to as string)) {
    errors.to = "This train does not call at these stops in this order";
  }
  if (!isAccept(body.accept)) errors.accept = "Choose CNF, RAC or WL";
  if (!isPhone(body.contact_phone)) errors.contact_phone = "Enter +91 and a 10-digit mobile number";
  assertValid(errors);
  const { run_date: runDate, quota, class: cls, accept, contact_phone: phone, passengers } = body;
  if (!isIsoDate(runDate) || !isQuota(quota) || !isClass(cls) || !isAccept(accept) || !isPhone(phone) || !Array.isArray(passengers)) {
    throw new Error("validated booking fields failed to narrow");
  }
  return {
    train: train.number,
    run_date: runDate,
    from: String(body.from),
    to: String(body.to),
    class: cls,
    quota,
    accept,
    contact_phone: phone,
    keep_in_one_coach: body.keep_in_one_coach === true,
    lower_berth_only: body.lower_berth_only === true,
    passengers: passengers.map((raw: unknown) => {
      const p = raw as Record<string, unknown>;
      return {
        name: String(p.name).trim(),
        age: Number(p.age),
        gender: p.gender as Gender,
        berth_preference: p.berth_preference as BerthPreference,
      };
    }),
  };
}

async function createBooking(app: App, account: AccountRow, input: BookingInput, now: number): Promise<BookingRow> {
  const train = findTrain(app.catalog, input.train);
  const stretch = train && stretchOf(train, input.from, input.to);
  if (!train || !stretch) throw notFound();
  const km = stretch.to.km - stretch.from.km;
  const quote = fareQuote(km, input.class, input.quota, input.passengers.map((p) => p.age));
  const client = await app.db.connect();
  let stage: "allot" | "payment" | "ticket" = "allot";
  let paymentId: string | undefined;
  let pnr = "";
  try {
    await client.query("BEGIN");
    await lockRun(client, train.number, input.run_date, input.class);
    const state = await loadRun(client, train, input.run_date, input.class);
    pnr = await freshPnr(client);
    const outcome = allot(cloneRun(state), {
      pnr,
      quota: input.quota,
      from: stretch.from.seq,
      to: stretch.to.seq,
      generalList: generalListFor(stretch.from),
      passengers: input.passengers.map((p) => ({ age: p.age, gender: p.gender, preference: p.berth_preference })),
      keepInOneCoach: input.keep_in_one_coach,
      lowerBerthOnly: input.lower_berth_only,
      accept: input.accept,
    });
    if (!outcome.ok) {
      throw new ApiError(409, outcome.error, REFUSALS[outcome.error], {
        ...(outcome.offer ? { offer: outcome.offer } : {}),
        charged: false,
      });
    }
    stage = "payment";
    const kbAccount = await killBillAccount(app.db, app.killbill, account);
    paymentId = await app.killbill.purchase(kbAccount, pnr, quote.total_paise);

    stage = "ticket";
    await client.query(
      `INSERT INTO bookings (pnr, account_id, train, run_date, class, quota, from_code, to_code, from_seq, to_seq,
         keep_in_one_coach, lower_berth_only, contact_phone, total_paise, fare_lines, version, kb_payment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $16)`,
      [pnr, account.id, train.number, input.run_date, input.class, input.quota, input.from, input.to, stretch.from.seq,
        stretch.to.seq, input.keep_in_one_coach, input.lower_berth_only, input.contact_phone, quote.total_paise,
        JSON.stringify(quote.lines), paymentId],
    );
    const labels: string[] = [];
    for (const [i, p] of outcome.passengers.entries()) {
      const given = input.passengers[i];
      if (!given) continue;
      const status = describe(p);
      labels.push(`Passenger ${p.number}: ${status.label}`);
      await client.query(
        `INSERT INTO passengers (pnr, number, name, age, gender, berth_preference, fare_paise, booking_status, status,
           position, coach, berth, rac_place, queue_seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [pnr, p.number, given.name, p.age, p.gender, given.berth_preference, passengerFare(km, input.class, input.quota, p.age),
          JSON.stringify(status), p.status, p.position, p.coach, p.berth, p.racPlace, p.seq],
      );
    }
    const row = await bookingRow(client, pnr);
    if (!row) throw new Error(`booking ${pnr} vanished inside its own transaction`);
    const snapshot = await reserveTicket(
      client,
      app.catalog,
      row,
      outcome.passengers.map((p, i) => ({ number: p.number, name: input.passengers[i]?.name ?? "", age: p.age, label: describe(p).label })),
      "booked",
      now,
    );
    await queueMail(client, {
      to: account.email,
      subject: `E-ticket for PNR ${pnr}`,
      text: `Your booking on ${train.number} ${train.name}, run date ${input.run_date}, holds these statuses.\n\n` +
        `${labels.join("\n")}\n\nYour e-ticket (version 1, as booked) is attached.\n\nPakka Rail`,
      attach: { pnr, version: snapshot.version },
    });
    await storeTicket(client, app.store, snapshot);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof ProviderUnavailable) console.error(`booking ${pnr}: ${error.message}`);
    if (paymentId) {
      await app.killbill.refund(paymentId, `${pnr}-void`, quote.total_paise).catch((e: unknown) => console.error(e));
    }
    if (error instanceof ProviderUnavailable && stage === "payment") {
      throw new ApiError(503, "payment_unavailable", "Payments are down right now. Nothing was charged.");
    }
    if (error instanceof ProviderUnavailable && stage === "ticket") {
      throw new ApiError(503, "ticket_storage_unavailable", "E-tickets can't be saved right now. Nothing was charged.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export const bookingRoutes: Route[] = [
  {
    method: "POST",
    pattern: /^\/api\/bookings$/,
    auth: true,
    idempotent: true,
    async handle(ctx, app) {
      const account = owner(ctx);
      const input = parseBooking(app, ctx.body, ctx.now);
      const row = await createBooking(app, account, input, ctx.now);
      return { status: 201, body: await bookingBody(app.db, app.catalog, row, ctx.now) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/bookings$/,
    auth: true,
    async handle(ctx, app) {
      const account = owner(ctx);
      const { rows } = await app.db.query<{ pnr: string }>(
        "SELECT pnr FROM bookings WHERE account_id = $1 ORDER BY seq DESC",
        [account.id],
      );
      const bookings: BookingSummary[] = [];
      for (const { pnr } of rows) {
        const row = await ownedBookingRow(app.db, pnr, account.id);
        const t = timelineOf(app.catalog, row, ctx.now);
        const passengers = await passengerRows(app.db, pnr);
        bookings.push({
          pnr,
          train: { number: t.train.number, name: t.train.name },
          run_date: row.run_date,
          from: row.from_code,
          to: row.to_code,
          class: row.class,
          state: stateOf(t),
          summary: passengers.map((p) => currentStatus(p, t).label).join(", "),
        });
      }
      return { status: 200, body: { bookings } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/bookings\/([^/]+)$/,
    auth: true,
    async handle(ctx, app) {
      const row = await ownedBookingRow(app.db, ctx.params[0] ?? "", owner(ctx).id);
      return { status: 200, body: await bookingBody(app.db, app.catalog, row, ctx.now) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/bookings\/([^/]+)\/tickets\/([^/]+)$/,
    auth: true,
    async handle(ctx, app) {
      const [pnr = "", version = ""] = ctx.params;
      const row = await ownedBookingRow(app.db, pnr, owner(ctx).id);
      const { rows } = await app.db.query<{ version: number; kind: "booked" | "cancellation" | "chart" }>(
        "SELECT version, kind FROM tickets WHERE pnr = $1 AND version = $2 AND stored",
        [row.pnr, /^\d{1,6}$/.test(version) ? Number(version) : 0],
      );
      const ticket = rows[0];
      if (!ticket) throw notFound();
      let object: { body: Buffer; etag: string };
      try {
        object = await app.store.get(ticketKey(row.pnr, ticket.version, ticket.kind));
      } catch (error) {
        if (error instanceof ProviderUnavailable) {
          throw new ApiError(503, "ticket_storage_unavailable", "E-tickets can't be downloaded right now.");
        }
        throw error;
      }
      return {
        status: 200,
        body: object.body,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="e-ticket-${row.pnr}-v${ticket.version}.pdf"`,
          "Content-Length": String(object.body.length),
          ETag: object.etag,
        },
      };
    },
  },
];
