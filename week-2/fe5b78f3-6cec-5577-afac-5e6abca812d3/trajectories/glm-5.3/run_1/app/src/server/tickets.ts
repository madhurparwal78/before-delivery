import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { buildPdf } from './pdf.js';
import { ticketKey, putTicket, StorageDown } from './minio.js';
import { labelFor } from './labels.js';
import { loadBooking, type BookingRow } from './cancel.js';
import { paiseToRupees } from '../money.js';

// E-ticket versions, numbered per PNR in the order of their events. A number
// is reserved when its event is recorded, and the PDF shows the statuses in
// force at that moment, reconstructed from the passenger history.

interface HistoryRow { passenger: number; at: Date; from_label: string; to_label: string }

async function statusLabelsAt(c: PoolClient, pnr: string, asOf: Date): Promise<Map<number, string>> {
  const hist = (
    await c.query<HistoryRow>(
      'SELECT passenger, at, from_label, to_label FROM passenger_history WHERE pnr = $1 ORDER BY at, passenger',
      [pnr],
    )
  ).rows;
  const current = (
    await c.query('SELECT * FROM passengers WHERE pnr = $1 ORDER BY number', [pnr])
  ).rows;
  const out = new Map<number, string>();
  for (const p of current) {
    const entries = hist.filter((h) => h.passenger === p.number);
    const last = entries.filter((h) => h.at.getTime() <= asOf.getTime()).at(-1);
    if (last) out.set(p.number, last.to_label);
    else if (entries.length > 0) out.set(p.number, entries[0].from_label);
    else out.set(p.number, labelFor(p));
  }
  return out;
}

export async function ticketPdf(c: PoolClient, pnr: string, asOf: Date): Promise<Buffer> {
  const b = await loadBooking(c, pnr);
  if (!b) throw new Error('no booking');
  const labels = await statusLabelsAt(c, pnr, asOf);
  const passengers = (
    await c.query('SELECT * FROM passengers WHERE pnr = $1 ORDER BY number', [pnr])
  ).rows;
  return buildPdf([
    { text: 'Pakka Rail e-ticket', bold: true, size: 16 },
    { text: `PNR: ${pnr}`, bold: true, size: 13 },
    { text: `Train: ${b.train}` },
    { text: `Run date: ${b.run_date}` },
    { text: `From: ${b.from_code}` },
    { text: `To: ${b.to_code}` },
    { text: `Class: ${b.cls}  Quota: ${b.quota}` },
    { text: `Total fare: ${paiseToRupees(Number(b.total_paise))}` },
    ...passengers.map((p) => ({ text: `Passenger ${p.number}: ${p.name}, ${p.age} — ${labels.get(p.number as number) ?? labelFor(p)}` })),
  ]);
}

/** Reserve the next version number for a PNR. */
export async function reserveTicket(c: PoolClient, pnr: string, kind: string): Promise<number> {
  const tver = Number((
    await c.query<{ n: string }>('SELECT COALESCE(MAX(version),0)+1 AS n FROM tickets WHERE pnr = $1', [pnr])
  ).rows[0].n);
  await c.query(`INSERT INTO tickets (pnr, version, kind, created_at) VALUES ($1,$2,$3,now())`, [pnr, tver, kind]);
  return tver;
}

/** Store a reserved version now; throws StorageDown when MinIO is unreachable. */
export async function storeTicket(c: PoolClient, pnr: string, version: number, kind: string, asOf: Date): Promise<void> {
  const pdf = await ticketPdf(c, pnr, asOf);
  const etag = await putTicket(ticketKey(pnr, version, kind), pdf);
  await c.query('UPDATE tickets SET stored = true, etag = $1 WHERE pnr = $2 AND version = $3', [etag, pnr, version]);
}

/** Store a version that was left unstored by an outage, keeping its reserved number. */
export async function storeUnstored(c: PoolClient, b: BookingRow): Promise<boolean> {
  const t = (
    await c.query<{ version: number; kind: string; created_at: Date }>(
      'SELECT version, kind, created_at FROM tickets WHERE pnr = $1 AND stored = false ORDER BY version', [b.pnr],
    )
  ).rows;
  if (t.length === 0) return true;
  for (const tick of t) {
    try {
      await storeTicket(c, b.pnr, tick.version, tick.kind, new Date(tick.created_at));
      await c.query('UPDATE bookings SET version = version + 1 WHERE pnr = $1', [b.pnr]);
    } catch (e) {
      if (e instanceof StorageDown) return false;
      throw e;
    }
  }
  return true;
}
