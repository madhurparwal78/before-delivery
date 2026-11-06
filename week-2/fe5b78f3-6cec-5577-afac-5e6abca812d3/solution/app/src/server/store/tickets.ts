// E-ticket versions: numbered per PNR in event order, reserved when the event is recorded, stored once and never rewritten.
import type { TicketKind } from "../../shared/api.js";
import { istTimestamp } from "../domain/clock.js";
import { type Catalog, findTrain } from "../domain/catalog.js";
import { type TicketSnapshot, renderTicket } from "../services/pdf.js";
import type { ObjectStore } from "../services/s3.js";
import type { BookingRow, Db } from "./rows.js";

export function ticketKey(pnr: string, version: number, kind: TicketKind): string {
  return `tickets/${pnr}/v${version}-${kind}.pdf`;
}

/** Reserves the next version number with the statuses in force at this event. */
export async function reserveTicket(
  db: Db,
  catalog: Catalog,
  booking: BookingRow,
  passengers: { number: number; name: string; age: number; label: string }[],
  kind: TicketKind,
  now: number,
): Promise<TicketSnapshot> {
  const { rows } = await db.query<{ next: number }>(
    "SELECT coalesce(max(version), 0) + 1 AS next FROM tickets WHERE pnr = $1",
    [booking.pnr],
  );
  const train = findTrain(catalog, booking.train);
  const name = (code: string): string => catalog.stations.find((s) => s.code === code)?.name ?? code;
  const snapshot: TicketSnapshot = {
    pnr: booking.pnr,
    version: rows[0]?.next ?? 1,
    kind,
    createdAt: istTimestamp(now),
    train: { number: booking.train, name: train?.name ?? "" },
    runDate: booking.run_date,
    from: { code: booking.from_code, name: name(booking.from_code) },
    to: { code: booking.to_code, name: name(booking.to_code) },
    cls: booking.class,
    quota: booking.quota,
    totalPaise: booking.total_paise,
    passengers,
  };
  await db.query("INSERT INTO tickets (pnr, version, kind, created_ms, snapshot) VALUES ($1, $2, $3, $4, $5)", [
    booking.pnr, snapshot.version, kind, now, JSON.stringify(snapshot),
  ]);
  return snapshot;
}

/** Puts the PDF in MinIO and marks the version stored; throws ProviderUnavailable when MinIO is down. */
export async function storeTicket(db: Db, store: ObjectStore, snapshot: TicketSnapshot): Promise<void> {
  const etag = await store.put(ticketKey(snapshot.pnr, snapshot.version, snapshot.kind), renderTicket(snapshot), "application/pdf");
  await db.query("UPDATE tickets SET stored = true, etag = $3, claimed_until = NULL WHERE pnr = $1 AND version = $2", [
    snapshot.pnr, snapshot.version, etag,
  ]);
}
