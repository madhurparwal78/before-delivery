// Database rows of bookings, holds and offers, and how each is shown on the wire.
import type { Booking, BookingSource, BookingStatus, DepositState, HoldResponse, HoldStatus, OfferResponse } from "../shared/api.js";
import { roomOfTable } from "./catalog.js";
import { instantIso } from "./clock.js";
import { refundCutoff } from "./domain/deposit.js";
import { isoWithLisbonOffset } from "./lisbon.js";

export interface BookingRow {
  reference: string;
  token: string | null;
  status: BookingStatus;
  source: BookingSource;
  date: string;
  time: string;
  starts_at: Date;
  party_size: number;
  target_id: string;
  table_ids: string[];
  name: string;
  email: string | null;
  phone: string | null;
  deposit_cents: number;
  deposit_state: DepositState;
}

export const BOOKING_COLUMNS =
  "reference, token, status, source, date, time, starts_at, party_size, target_id, table_ids, name, email, phone, deposit_cents, deposit_state";

export function bookingRoomName(row: Pick<BookingRow, "table_ids">): string {
  return roomOfTable(row.table_ids[0] ?? "").name;
}

export function toBooking(row: BookingRow): Booking {
  return {
    reference: row.reference,
    status: row.status,
    source: row.source,
    date: row.date,
    time: row.time,
    starts_at: isoWithLisbonOffset(row.starts_at),
    party_size: row.party_size,
    table_id: row.target_id,
    room: bookingRoomName(row),
    name: row.name,
    deposit: { amount_cents: row.deposit_cents, state: row.deposit_state },
    refund_cutoff: row.source === "walk_in" ? null : isoWithLisbonOffset(refundCutoff(row.starts_at)),
  };
}

export interface HoldRow {
  hold_id: string;
  date: string;
  time: string;
  party_size: number;
  target_id: string;
  table_ids: string[];
  status: HoldStatus;
  deposit_cents: number;
  window_start: Date;
  window_end: Date;
  expires_at: Date;
}

export const HOLD_COLUMNS =
  "hold_id, date, time, party_size, target_id, table_ids, status, deposit_cents, window_start, window_end, expires_at";

export function toHold(row: HoldRow, status: HoldStatus, serverNow: Date): HoldResponse {
  return {
    hold_id: row.hold_id,
    table_id: row.target_id,
    date: row.date,
    time: row.time,
    party_size: row.party_size,
    status,
    expires_at: instantIso(row.expires_at),
    server_now: instantIso(serverNow),
    deposit_cents: row.deposit_cents,
  };
}

export interface OfferRow {
  offer_id: string;
  token: string;
  entry_id: string;
  date: string;
  time: string;
  party_size: number;
  target_id: string;
  table_ids: string[];
  status: "offered" | "claimed" | "lapsed";
  deposit_cents: number;
  window_start: Date;
  window_end: Date;
  expires_at: Date;
}

export const OFFER_COLUMNS =
  "offer_id, token, entry_id, date, time, party_size, target_id, table_ids, status, deposit_cents, window_start, window_end, expires_at";

export function toOffer(row: OfferRow, startsAt: Date, serverNow: Date): OfferResponse {
  return {
    status: "offered",
    date: row.date,
    time: row.time,
    starts_at: isoWithLisbonOffset(startsAt),
    party_size: row.party_size,
    table_id: row.target_id,
    room: bookingRoomName(row),
    expires_at: instantIso(row.expires_at),
    server_now: instantIso(serverNow),
    deposit_cents: row.deposit_cents,
  };
}
