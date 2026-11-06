// Background work. Each job claims its rows with FOR UPDATE SKIP LOCKED and a short lease, so instances that share the
// database do every chart, ticket, refund and mail once, and an instance whose provider is down hands the work back.
import type { Refund, TicketKind } from "../shared/api.js";
import { POSITION_WORD, formatInr } from "../shared/format.js";
import type { App } from "./app.js";
import { chartFull } from "./domain/bands.js";
import { chartAt, isChartPrepared } from "./domain/schedule.js";
import { atChart, describe, isQueue } from "./domain/status.js";
import { ProviderUnavailable } from "./services/errors.js";
import { type TicketSnapshot, renderTicket } from "./services/pdf.js";
import { queueMail } from "./store/outbox.js";
import { type BookingRow, bookingRow, bookingsOnRun, bumpVersion, passengerRows } from "./store/rows.js";
import { lockRun } from "./store/runs.js";
import { reserveTicket, storeTicket } from "./store/tickets.js";
import { fieldsOf, timelineOf } from "./store/view.js";

const RETRY_LEASE = "5 seconds";
/** After a provider failure this instance waits longer than the lease, so an instance that can reach it goes first. */
const FAILURE_BACKOFF_MS = 15_000;

async function sendMail(app: App): Promise<boolean> {
  const { rows } = await app.db.query<{ id: number; to_address: string; subject: string; body: string; attach_pnr: string | null; attach_version: number | null }>(
    `UPDATE outbox SET claimed_until = now() + interval '60 seconds'
      WHERE id = (SELECT id FROM outbox WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
                  ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, to_address, subject, body, attach_pnr, attach_version`,
  );
  const mail = rows[0];
  if (!mail) return false;
  try {
    let attachment: { filename: string; contentType: string; content: Buffer } | undefined;
    if (mail.attach_pnr && mail.attach_version) {
      const ticket = await app.db.query<{ snapshot: TicketSnapshot }>("SELECT snapshot FROM tickets WHERE pnr = $1 AND version = $2", [
        mail.attach_pnr, mail.attach_version,
      ]);
      const snapshot = ticket.rows[0]?.snapshot;
      if (snapshot) {
        attachment = { filename: `e-ticket-${snapshot.pnr}-v${snapshot.version}.pdf`, contentType: "application/pdf", content: renderTicket(snapshot) };
      }
    }
    await app.mailer.send({ to: mail.to_address, subject: mail.subject, text: mail.body, ...(attachment ? { attachment } : {}) });
    await app.db.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [mail.id]);
  } catch (error) {
    await app.db.query(`UPDATE outbox SET claimed_until = now() + interval '${RETRY_LEASE}' WHERE id = $1`, [mail.id]);
    throw error;
  }
  return true;
}

async function issueRefund(app: App): Promise<boolean> {
  const { rows } = await app.db.query<{ pnr: string; number: number; refund_paise: number }>(
    `UPDATE refunds SET claimed_until = now() + interval '60 seconds'
      WHERE (pnr, number) = (SELECT pnr, number FROM refunds WHERE status = 'pending'
                               AND (claimed_until IS NULL OR claimed_until < now())
                             ORDER BY pnr, number LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING pnr, number, refund_paise`,
  );
  const refund = rows[0];
  if (!refund) return false;
  const booking = await bookingRow(app.db, refund.pnr);
  if (!booking) throw new Error(`refund ${refund.pnr}-${refund.number} has no booking`);
  try {
    await app.killbill.refund(booking.kb_payment_id, `${refund.pnr}-refund-${refund.number}`, refund.refund_paise);
  } catch (error) {
    await app.db.query(`UPDATE refunds SET claimed_until = now() + interval '${RETRY_LEASE}' WHERE pnr = $1 AND number = $2`, [
      refund.pnr, refund.number,
    ]);
    throw error;
  }
  const client = await app.db.connect();
  try {
    await client.query("BEGIN");
    const issued = await client.query<Pick<Refund, "status">>(
      "UPDATE refunds SET status = 'issued', issued_ms = $3, claimed_until = NULL WHERE pnr = $1 AND number = $2 AND status = 'pending' RETURNING status",
      [refund.pnr, refund.number, app.clock.now()],
    );
    if (issued.rowCount === 1) {
      await bumpVersion(client, refund.pnr);
      await queueMail(client, {
        to: booking.email,
        subject: `Refund issued: PNR ${refund.pnr}`,
        text: `Kill Bill has issued your refund of ${formatInr(refund.refund_paise)} for PNR ${refund.pnr}.\n\nPakka Rail`,
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return true;
}

/** Stores an e-ticket version whose event happened while MinIO was down; that late store is its own version step. */
async function storeLateTicket(app: App): Promise<boolean> {
  const { rows } = await app.db.query<{ snapshot: TicketSnapshot }>(
    `UPDATE tickets SET claimed_until = now() + interval '60 seconds'
      WHERE (pnr, version) = (SELECT pnr, version FROM tickets WHERE NOT stored
                                AND (claimed_until IS NULL OR claimed_until < now())
                              ORDER BY pnr, version LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING snapshot`,
  );
  const snapshot = rows[0]?.snapshot;
  if (!snapshot) return false;
  const client = await app.db.connect();
  try {
    await client.query("BEGIN");
    await storeTicket(client, app.store, snapshot);
    await bumpVersion(client, snapshot.pnr);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await app.db.query(`UPDATE tickets SET claimed_until = now() + interval '${RETRY_LEASE}' WHERE pnr = $1 AND version = $2`, [
      snapshot.pnr, snapshot.version,
    ]);
    throw error;
  } finally {
    client.release();
  }
  return true;
}

function chartLine(number: number, status: ReturnType<typeof describe>): string {
  const label = status.label;
  if (status.status === "CNF") {
    return `Passenger ${number}: ${label}, coach ${status.coach} berth ${status.berth} ${status.berth_type ? POSITION_WORD[status.berth_type] : ""}`;
  }
  if (status.status === "RAC") return `Passenger ${number}: ${label}, RAC place on coach ${status.coach} side lower ${status.berth}`;
  if (status.status === "CHART_NOT_CONFIRMED") return `Passenger ${number}: NOT CNF, not confirmed. The fare is refunded in full.`;
  return `Passenger ${number}: ${label}`;
}

/** Records what the chart instant produced for one booking (brief: Chart preparation). */
async function chartBooking(app: App, row: BookingRow, chart: number): Promise<void> {
  const client = await app.db.connect();
  try {
    await client.query("BEGIN");
    await lockRun(client, row.train, row.run_date, row.class);
    const fresh = await bookingRow(client, row.pnr, true);
    if (!fresh || fresh.chart_recorded) {
      await client.query("ROLLBACK");
      return;
    }
    const t = timelineOf(app.catalog, fresh, chart);
    const passengers = await passengerRows(client, row.pnr);
    const notConfirmed = passengers.filter((p) => isQueue(p.status));
    for (const p of notConfirmed) {
      const from = describe(fieldsOf(p));
      await client.query("UPDATE passengers SET status = 'CHART_NOT_CONFIRMED', position = NULL, queue_seq = NULL WHERE pnr = $1 AND number = $2", [
        p.pnr, p.number,
      ]);
      await client.query("INSERT INTO history (pnr, number, at_ms, from_label, to_label) VALUES ($1, $2, $3, $4, 'NOT CNF')", [
        p.pnr, p.number, chart, from.label,
      ]);
    }
    if (notConfirmed.length > 0) {
      const entries = notConfirmed.map((p) => chartFull(p.number, p.fare_paise, fresh.class));
      const total = entries.reduce((sum, e) => sum + e.refund_paise, 0);
      const counts = await client.query<{ cancellations: number; refunds: number }>(
        `SELECT (SELECT count(*)::int FROM cancellations WHERE pnr = $1) AS cancellations,
                (SELECT count(*)::int FROM refunds WHERE pnr = $1) AS refunds`,
        [row.pnr],
      );
      await client.query("INSERT INTO cancellations (pnr, number, requested_ms, passengers, refund_paise) VALUES ($1, $2, $3, $4, $5)", [
        row.pnr, (counts.rows[0]?.cancellations ?? 0) + 1, chart, JSON.stringify(entries), total,
      ]);
      if (total > 0) {
        await client.query("INSERT INTO refunds (pnr, number, reason, refund_paise) VALUES ($1, $2, 'chart', $3)", [
          row.pnr, (counts.rows[0]?.refunds ?? 0) + 1, total,
        ]);
      }
    }
    const final = passengers.map((p) => ({ p, status: describe(atChart(fieldsOf(p))) }));
    const kind: TicketKind = "chart";
    const snapshot = await reserveTicket(
      client,
      app.catalog,
      fresh,
      final.map(({ p, status }) => ({ number: p.number, name: p.name, age: p.age, label: status.label })),
      kind,
      chart,
    );
    if (final.some(({ status }) => status.status !== "CAN")) {
      await queueMail(client, {
        to: fresh.email,
        subject: `Chart prepared: PNR ${row.pnr}`,
        text: `The chart for ${t.train.number} ${t.train.name}, run date ${fresh.run_date}, is prepared. Statuses are final.\n\n` +
          `${final.map(({ p, status }) => chartLine(p.number, status)).join("\n")}\n\nPakka Rail`,
      });
    }
    await client.query("UPDATE bookings SET chart_recorded = true WHERE pnr = $1", [row.pnr]);
    await bumpVersion(client, row.pnr);
    await storeTicket(client, app.store, snapshot).catch((error: unknown) => {
      if (!(error instanceof ProviderUnavailable)) throw error;
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function prepareCharts(app: App): Promise<boolean> {
  const now = app.clock.now();
  const { rows } = await app.db.query<{ train: string; run_date: string }>(
    "SELECT DISTINCT train, run_date FROM bookings WHERE NOT chart_recorded",
  );
  for (const run of rows) {
    const train = app.catalog.trains.find((t) => t.number === run.train);
    if (!train) continue;
    const chart = chartAt(train, run.run_date);
    if (!isChartPrepared(now, chart)) continue;
    for (const booking of await bookingsOnRun(app.db, run.train, run.run_date)) {
      if (!booking.chart_recorded) await chartBooking(app, booking, chart);
    }
  }
  return false;
}

function loop(name: string, everyMs: number, step: (app: App) => Promise<boolean>, app: App): () => void {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    clearTimeout(timer);
    let wait = everyMs;
    try {
      while (await step(app));
    } catch (error) {
      console.error(`${name}: ${String(error)}`);
      wait = FAILURE_BACKOFF_MS;
    } finally {
      running = false;
      timer = setTimeout(() => void tick(), wait);
    }
  };
  timer = setTimeout(() => void tick(), everyMs);
  return () => void tick();
}

/** Starts every worker and returns the nudge that wakes the refund and ticket workers at once. */
export function startJobs(app: App): () => void {
  loop("outbox", 2000, sendMail, app);
  loop("charts", 1000, prepareCharts, app);
  const refunds = loop("refunds", 5000, issueRefund, app);
  const tickets = loop("tickets", 5000, storeLateTicket, app);
  return () => {
    refunds();
    tickets();
  };
}
