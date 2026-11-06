// Builds the brief's request objects in a few batched queries; seat and request states are derived here.
import type { OfferSummary, RequestView, SeatView } from "../shared/api.js";
import type { OfferStatus, RequestStatus, SeatStatus, Setting, TimesheetStatus } from "../shared/domain.js";
import { type Db, rows } from "./db.js";
import { cancellationWindow, derivedStatus, holdingOfferSql, offerStatus, scheduledHundredths } from "./domain/rules.js";
import { formatCents, formatHundredths } from "./money.js";

export interface RequestRow {
  id: string;
  ref_no: number;
  org_id: string;
  org_name: string;
  title: string;
  setting: Setting;
  location: string;
  start_at: Date;
  end_at: Date;
  consumer_id: string;
  consumer_name: string;
  notes: string;
  status: RequestStatus;
  logged_after: boolean;
  cancellation_fee_cents: number | null;
}

export const REQUEST_SELECT = `
  SELECT r.id, r.ref_no, r.org_id, o.name AS org_name, r.title, r.setting, r.location, r.start_at, r.end_at,
         r.consumer_id, c.name AS consumer_name, r.notes, r.status, r.logged_after, r.cancellation_fee_cents
  FROM requests r JOIN orgs o ON o.id = r.org_id JOIN users c ON c.id = r.consumer_id`;

export const refOf = (refNo: number): string => `FA-${refNo}`;

interface SeatRow {
  id: string;
  request_id: string;
  position: number;
}

interface OfferRow {
  id: string;
  seat_id: string;
  status: OfferStatus;
  sent_at: Date;
  expires_at: Date;
  interpreter_id: string;
  interpreter_name: string;
  holder_id: string;
  holder_name: string;
  mailed: boolean;
}

interface TimesheetRow {
  id: string;
  seat_id: string;
  status: TimesheetStatus;
  billed_hundredths: number;
  amount_cents: number | null;
}

interface PrepRow {
  id: string;
  request_id: string;
  filename: string;
  size: number;
  content_type: string;
}

function seatView(seat: SeatRow, offer: OfferRow | undefined, sheet: TimesheetRow | undefined, now: Date): SeatView {
  const status = offer ? offerStatus(offer.status, offer.expires_at, now) : null;
  const seatStatus: SeatStatus = status === "accepted" ? "accepted" : status === "active" ? "offered" : "open";
  const live = seatStatus !== "open" && offer;
  const summary: OfferSummary | null =
    offer && status
      ? { id: offer.id, status, sent_at: offer.sent_at.toISOString(), expires_at: offer.expires_at.toISOString(), email: offer.mailed ? "sent" : "queued" }
      : null;
  return {
    id: seat.id,
    position: seat.position,
    status: seatStatus,
    interpreter: live ? { id: live.interpreter_id, name: live.interpreter_name } : null,
    held_by: live ? { id: live.holder_id, name: live.holder_name } : null,
    offer: summary,
    timesheet: sheet
      ? {
          id: sheet.id,
          status: sheet.status,
          billed_hours: formatHundredths(sheet.billed_hundredths),
          amount: sheet.amount_cents === null ? null : formatCents(sheet.amount_cents),
        }
      : null,
  };
}

/** Request objects for `requests`, in the given order. */
export async function requestViews(db: Db, requests: RequestRow[], now: Date = new Date()): Promise<RequestView[]> {
  if (!requests.length) return [];
  const ids = requests.map((r) => r.id);
  const [seats, offers, sheets, preps] = await Promise.all([
    rows<SeatRow>(db, "SELECT id, request_id, position FROM seats WHERE request_id = ANY($1) ORDER BY position", [ids]),
    rows<OfferRow>(
      db,
      `SELECT DISTINCT ON (o.seat_id) o.id, o.seat_id, o.status, o.sent_at, o.expires_at,
              o.interpreter_id, i.name AS interpreter_name, o.held_by AS holder_id, h.name AS holder_name,
              (o.outbox_id IS NULL OR m.sent_at IS NOT NULL) AS mailed
       FROM offers o JOIN seats s ON s.id = o.seat_id
       JOIN users i ON i.id = o.interpreter_id JOIN users h ON h.id = o.held_by
       LEFT JOIN outbox m ON m.id = o.outbox_id
       WHERE s.request_id = ANY($1)
       ORDER BY o.seat_id, ${holdingOfferSql("$2")} DESC, o.sent_at DESC`,
      [ids, now],
    ),
    rows<TimesheetRow>(
      db,
      `SELECT t.id, t.seat_id, t.status, t.billed_hundredths, t.amount_cents
       FROM timesheets t JOIN seats s ON s.id = t.seat_id WHERE s.request_id = ANY($1)`,
      [ids],
    ),
    rows<PrepRow>(db, "SELECT id, request_id, filename, size, content_type FROM prep_files WHERE request_id = ANY($1) ORDER BY created_at, id", [ids]),
  ]);
  const offerBySeat = new Map(offers.map((o) => [o.seat_id, o]));
  const sheetBySeat = new Map(sheets.map((t) => [t.seat_id, t]));
  return requests.map((r) => {
    const status = derivedStatus(r.status, r.end_at, now);
    const seatViews = seats.filter((s) => s.request_id === r.id).map((s) => seatView(s, offerBySeat.get(s.id), sheetBySeat.get(s.id), now));
    return {
      id: r.id,
      ref: refOf(r.ref_no),
      org_id: r.org_id,
      org_name: r.org_name,
      title: r.title,
      setting: r.setting,
      location: r.location,
      start: r.start_at.toISOString(),
      end: r.end_at.toISOString(),
      duration_hours: formatHundredths(scheduledHundredths(r.start_at, r.end_at)),
      consumer: { id: r.consumer_id, name: r.consumer_name },
      notes: r.notes,
      status,
      logged_after: r.logged_after,
      seats_total: seatViews.length,
      seats_claimed: seatViews.filter((s) => s.status !== "open").length,
      seats_accepted: seatViews.filter((s) => s.status === "accepted").length,
      in_cancellation_window: cancellationWindow({ status, start: r.start_at, end: r.end_at }, now).late,
      cancellation_fee: r.cancellation_fee_cents === null ? null : formatCents(r.cancellation_fee_cents),
      seats: seatViews,
      prep_files: preps.filter((p) => p.request_id === r.id).map(({ id, filename, size, content_type }) => ({ id, filename, size, content_type })),
    };
  });
}

export async function requestRows(db: Db, where: string, params: unknown[], order = "r.start_at"): Promise<RequestRow[]> {
  return rows<RequestRow>(db, `${REQUEST_SELECT} WHERE ${where} ORDER BY ${order}`, params);
}

export async function requestView(db: Db, id: string): Promise<RequestView | undefined> {
  const [row] = await requestRows(db, "r.id = $1", [id]);
  return row ? (await requestViews(db, [row]))[0] : undefined;
}
