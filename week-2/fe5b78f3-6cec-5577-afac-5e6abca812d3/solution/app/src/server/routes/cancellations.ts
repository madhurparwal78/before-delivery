// Cancellation quotes and cancellations: bands at the arrival instant, one change per run and class, promotions inside it.
import type { CancellationQuote, CancelledPassenger, CancellationResult } from "../../shared/api.js";
import type { App } from "../app.js";
import { type BandContext, isPartConfirmedParty, quotePassengers } from "../domain/bands.js";
import { istTimestamp } from "../domain/clock.js";
import { isChild } from "../domain/fare.js";
import { cancelPassengers } from "../domain/promote.js";
import { cloneRun } from "../domain/run.js";
import { isFinal } from "../domain/status.js";
import { selectionErrors } from "../domain/validate.js";
import type { Ctx, Route } from "../http/api.js";
import { ApiError, assertValid } from "../http/errors.js";
import { owner } from "../http/session.js";
import { ProviderUnavailable } from "../services/errors.js";
import { type BookingRow, type Db, bookingRow, bumpVersion, ownedBookingRow, passengerRows } from "../store/rows.js";
import { loadRun, lockRun, recordRunChange } from "../store/runs.js";
import { reserveTicket, storeTicket } from "../store/tickets.js";
import { bookingBody, cancellationOf, currentStatus, timelineOf } from "../store/view.js";

/** Refusals in the brief's precedence (state conflicts, then fields), then the quote for the selected passengers. */
async function quoteFor(db: Db, app: App, row: BookingRow, selection: unknown, now: number): Promise<CancellationQuote> {
  const t = timelineOf(app.catalog, row, now);
  const passengers = (await passengerRows(db, row.pnr)).map((p) => ({ ...p, current: currentStatus(p, t) }));
  if (t.complete) throw new ApiError(409, "journey_complete", "This journey is complete. It can no longer be cancelled.");
  const chosen = Array.isArray(selection) ? passengers.filter((p) => selection.includes(p.number)) : [];
  if (chosen.some((p) => isFinal(p.current.status))) {
    throw new ApiError(409, "already_cancelled", "That passenger is already cancelled.");
  }
  assertValid(selectionErrors(selection, passengers.map((p) => p.number)));
  const instant = Math.floor(now / 1000) * 1000;
  const remainingAdults = passengers.filter((p) => !isChild(p.age) && !isFinal(p.current.status));
  const ctx: BandContext = {
    now: instant,
    chartPrepared: t.chartDue,
    departureAt: t.departureAt,
    cls: row.class,
    quota: row.quota,
    partConfirmedParty: isPartConfirmedParty(
      row.quota,
      !t.chartDue,
      remainingAdults.map((p) => ({ number: p.number, status: p.current.status })),
      chosen.map((p) => p.number),
    ),
  };
  const quoted: CancelledPassenger[] = quotePassengers(
    ctx,
    row.class,
    chosen.map((p) => ({ number: p.number, age: p.age, fare: p.fare_paise, status: p.current.status })),
  );
  return { quoted_at: istTimestamp(now), passengers: quoted, refund_paise: quoted.reduce((sum, p) => sum + p.refund_paise, 0) };
}

async function cancel(app: App, ctx: Ctx): Promise<CancellationResult> {
  const pnr = ctx.params[0] ?? "";
  const accountId = owner(ctx).id;
  await ownedBookingRow(app.db, pnr, accountId);
  const client = await app.db.connect();
  try {
    await client.query("BEGIN");
    const preview = await bookingRow(client, pnr);
    if (!preview) throw new Error(`booking ${pnr} vanished`);
    await lockRun(client, preview.train, preview.run_date, preview.class);
    const row = await ownedBookingRow(client, pnr, accountId);
    const quote = await quoteFor(client, app, row, ctx.body.passengers, ctx.now);
    const t = timelineOf(app.catalog, row, ctx.now);
    const before = await loadRun(client, t.train, row.run_date, row.class);
    const after = cloneRun(before);
    cancelPassengers(after, pnr, quote.passengers.map((p) => p.number), !t.chartDue);
    await recordRunChange(client, before, after, ctx.now, pnr);

    const numbers = await client.query<{ cancellations: number; refunds: number }>(
      `SELECT (SELECT count(*)::int FROM cancellations WHERE pnr = $1) AS cancellations,
              (SELECT count(*)::int FROM refunds WHERE pnr = $1) AS refunds`,
      [pnr],
    );
    const entry = { number: (numbers.rows[0]?.cancellations ?? 0) + 1, requested_ms: ctx.now, passengers: quote.passengers, refund_paise: quote.refund_paise };
    await client.query("INSERT INTO cancellations (pnr, number, requested_ms, passengers, refund_paise) VALUES ($1, $2, $3, $4, $5)", [
      pnr, entry.number, entry.requested_ms, JSON.stringify(entry.passengers), entry.refund_paise,
    ]);
    if (quote.refund_paise > 0) {
      await client.query("INSERT INTO refunds (pnr, number, reason, refund_paise) VALUES ($1, $2, 'cancellation', $3)", [
        pnr, (numbers.rows[0]?.refunds ?? 0) + 1, quote.refund_paise,
      ]);
    }
    await bumpVersion(client, pnr);
    const passengers = await passengerRows(client, pnr);
    const snapshot = await reserveTicket(
      client,
      app.catalog,
      row,
      passengers.map((p) => ({ number: p.number, name: p.name, age: p.age, label: currentStatus(p, t).label })),
      "cancellation",
      ctx.now,
    );
    await storeTicket(client, app.store, snapshot).catch((error: unknown) => {
      if (!(error instanceof ProviderUnavailable)) throw error;
    });
    await client.query("COMMIT");
    app.nudge();
    const committed = await bookingRow(app.db, pnr);
    if (!committed) throw new Error(`booking ${pnr} vanished after its cancellation`);
    const booking = await bookingBody(app.db, app.catalog, committed, ctx.now);
    return {
      cancellation: cancellationOf(entry),
      refund: booking.refunds.find((r) => r.number === (numbers.rows[0]?.refunds ?? 0) + 1 && quote.refund_paise > 0) ?? null,
      booking,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const cancellationRoutes: Route[] = [
  {
    method: "POST",
    pattern: /^\/api\/bookings\/([^/]+)\/cancellation-quote$/,
    auth: true,
    async handle(ctx, app) {
      const row = await ownedBookingRow(app.db, ctx.params[0] ?? "", owner(ctx).id);
      return { status: 200, body: await quoteFor(app.db, app, row, ctx.body.passengers, ctx.now) };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/bookings\/([^/]+)\/cancellations$/,
    auth: true,
    idempotent: true,
    async handle(ctx, app) {
      return { status: 201, body: await cancel(app, ctx) };
    },
  },
];
