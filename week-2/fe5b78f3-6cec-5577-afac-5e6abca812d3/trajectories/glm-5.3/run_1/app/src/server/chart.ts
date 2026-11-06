import type { PoolClient } from 'pg';
import { runContext, TRAINS } from '../seed.js';
import { nowMs, istDate, istStamp, parseIstDate } from '../time.js';
import { labelFor } from './labels.js';
import { loadBooking, runContextOf, type BookingRow } from './cancel.js';
import { buildPdf } from './pdf.js';
import { ticketKey, putTicket, StorageDown } from './minio.js';
import { createHash } from 'node:crypto';

// The chart, recorded within 5 real seconds of the chart instant: freeze every
// PNR, move waitlisted passengers to not confirmed, refund their fare, and
// mail and store the chart e-tickets.

export async function runChartJob(c: PoolClient): Promise<number> {
  const now = nowMs();
  let chartsDone = 0;
  for (const train of TRAINS) {
    // every run whose chart instant has arrived on the business clock
    for (let d = -3; d <= 62; d++) {
      const runMs = now + d * 86_400_000;
      const runDate = istDate(runMs);
      const rc = runContext(train.number, parseIstDate(runDate)!);
      if (!rc) continue;
      if (rc.chartMs > now) continue;
      const done = await c.query(
        'SELECT 1 FROM chart_done WHERE train = $1 AND run_date = $2',
        [train.number, runDate],
      );
      if ((done.rowCount ?? 0) > 0) continue;
      // take the chart lock inside a transaction per run
      const ok = await prepareChartForRun(c, train.number, runDate);
      if (ok) chartsDone++;
    }
  }
  return chartsDone;
}

async function prepareChartForRun(c: PoolClient, trainNumber: string, runDate: string): Promise<boolean> {
  const rc = runContext(trainNumber, parseIstDate(runDate)!);
  if (!rc) return false;
  const chartAt = rc.chartMs;
  const inserted = await c.query(
    `INSERT INTO chart_done (train, run_date, chart_at, done_at)
     SELECT $1, $2, $3, now()
     WHERE NOT EXISTS (SELECT 1 FROM chart_done WHERE train = $1 AND run_date = $2)`,
    [trainNumber, runDate, new Date(chartAt)],
  );
  if ((inserted.rowCount ?? 0) === 0) return false;

  const bookings = (
    await c.query<BookingRow>("SELECT *, to_char(run_date, 'YYYY-MM-DD') AS run_date FROM bookings WHERE train = $1 AND run_date = $2", [trainNumber, runDate])
  ).rows;

  for (const b of bookings) {
    await prepareChartForBooking(c, b, chartAt);
  }
  return true;
}

async function prepareChartForBooking(c: PoolClient, b: BookingRow, chartAt: number): Promise<void> {
  const passengers = (
    await c.query('SELECT * FROM passengers WHERE pnr = $1 ORDER BY number', [b.pnr])
  ).rows;
  const waitlisted = passengers.filter((p) =>
    p.status === 'GNWL' || p.status === 'RLWL' || p.status === 'PQWL' || p.status === 'TQWL');

  if (waitlisted.length > 0) {
    const cnum = Number((
      await c.query<{ n: string }>('SELECT COALESCE(MAX(number),0)+1 AS n FROM cancellations WHERE pnr = $1', [b.pnr])
    ).rows[0].n);
    const entries = waitlisted.map((p) => ({
      number: p.number as number,
      band: 'chart_full',
      charge_paise: 0,
      gst_paise: 0,
      deduction_paise: 0,
      refund_paise: Number(p.fare_paise),
    }));
    const refundTotal = entries.reduce((a, e) => a + e.refund_paise, 0);
    await c.query(
      `INSERT INTO cancellations (pnr, number, requested_at, refund_paise, reason) VALUES ($1,$2,$3,$4,'chart')`,
      [b.pnr, cnum, new Date(chartAt), refundTotal],
    );
    for (const e of entries) {
      await c.query(
        `INSERT INTO cancellation_passengers (pnr, cancellation, number, band, charge_paise, gst_paise, deduction_paise, refund_paise)
         VALUES ($1,$2,$3,'chart_full',0,0,0,$4)`,
        [b.pnr, cnum, e.number, e.refund_paise],
      );
    }
    for (const p of waitlisted) {
      await c.query(
        `INSERT INTO passenger_history (pnr, passenger, at, from_label, to_label) VALUES ($1,$2,$3,$4,'NOT CNF')`,
        [b.pnr, p.number, new Date(chartAt), labelFor(p)],
      );
      await c.query(
        `UPDATE passengers SET status = 'CHART_NOT_CONFIRMED', wl_type = NULL, wl_num = NULL WHERE pnr = $1 AND number = $2`,
        [b.pnr, p.number],
      );
    }
    if (refundTotal > 0) {
      const rnum = Number((
        await c.query<{ n: string }>('SELECT COALESCE(MAX(number),0)+1 AS n FROM refunds WHERE pnr = $1', [b.pnr])
      ).rows[0].n);
      await c.query(
        `INSERT INTO refunds (pnr, number, reason, refund_paise, status) VALUES ($1,$2,'chart',$3,'pending')`,
        [b.pnr, rnum, refundTotal],
      );
    }
  }

  // The chart e-ticket version, numbered after booked and cancellation versions.
  const hasUncancelled = passengers.some((p) => p.status !== 'CAN');
  if (hasUncancelled) {
    const tver = Number((
      await c.query<{ n: string }>('SELECT COALESCE(MAX(version),0)+1 AS n FROM tickets WHERE pnr = $1', [b.pnr])
    ).rows[0].n);
    await c.query(`INSERT INTO tickets (pnr, version, kind, created_at) VALUES ($1,$2,'chart',now())`, [b.pnr, tver]);
  }

  // The chart raises the booking version by exactly one.
  await c.query('UPDATE bookings SET version = $2, state = \'chart_prepared\' WHERE pnr = $1', [b.pnr, b.version + 1]);

  // The chart mail: every passenger's final result.
  const ownerR = await c.query<{ email: string }>(
    'SELECT a.email FROM accounts a WHERE a.id = $1', [b.account_id],
  );
  const email = ownerR.rows[0]?.email;
  if (email && hasUncancelled) {
    const fresh = (await c.query('SELECT * FROM passengers WHERE pnr = $1 ORDER BY number', [b.pnr])).rows;
    const lines = fresh.map((p) => `Passenger ${p.number}: ${labelFor(p)}`);
    await c.query('INSERT INTO mail_outbox (to_email, subject, body) VALUES ($1,$2,$3)',
      [email, `Chart prepared: PNR ${b.pnr}`, `${lines.join('\n')}\n`]);
  }
}

/** Store a chart e-ticket for one booking, retrying while MinIO is unreachable. */
export async function storeChartTicket(pnr: string): Promise<boolean> {
  return storePendingTicket(pnr);
}

/** Store any reserved-but-unstored e-ticket version for a PNR. */
export async function storePendingTicket(pnr: string): Promise<boolean> {
  const { pool } = await import('./db.js');
  return pool.connect().then(async (c) => {
    try {
      const t = await c.query(
        `SELECT version, kind FROM tickets WHERE pnr = $1 AND stored = false ORDER BY version`,
        [pnr],
      );
      if (t.rows.length === 0) return true;
      const b = await loadBooking(c, pnr);
      if (!b) return false;
      const rc = runContextOf(b);
      if (!rc) return false;
      const passengers = (await c.query('SELECT * FROM passengers WHERE pnr = $1 ORDER BY number', [pnr])).rows;
      for (const tick of t.rows) {
        // statuses in force when the event was recorded: the chart version shows
        // the frozen result, so current rows are correct here only for 'chart'
        // and 'cancellation' versions created after the event.
        const pdf = buildPdf([
          { text: 'Pakka Rail e-ticket', bold: true, size: 16 },
          { text: `PNR: ${pnr}`, bold: true, size: 13 },
          { text: `Train: ${b.train}` },
          { text: `Run date: ${b.run_date}` },
          { text: `From: ${b.from_code}` },
          { text: `To: ${b.to_code}` },
          { text: `Class: ${b.cls}  Quota: ${b.quota}` },
          ...passengers.map((p) => ({ text: `Passenger ${p.number}: ${labelFor(p)}` })),
        ]);
        try {
          const etag = await putTicket(ticketKey(pnr, tick.version as number, tick.kind as string), pdf);
          await c.query('UPDATE tickets SET stored = true, etag = $1 WHERE pnr = $2 AND version = $3',
            [etag, pnr, tick.version]);
          await c.query('UPDATE bookings SET version = version + 1 WHERE pnr = $1', [pnr]);
        } catch (e) {
          if (e instanceof StorageDown) return false;
          throw e;
        }
      }
      return true;
    } finally {
      c.release();
    }
  });
}
