import type { Cancellation, Entry, Folio, Invoice, LinkState, Night, Segment, Stay, StayStatus } from "../shared/api";
import type { IsoDate } from "../shared/dates";
import { rows, type Queryable, type Row } from "./db";
import { isUuid } from "./http";
import { hotelNow } from "./clock";
import { loadHotel, taxRatesOf, type HotelRecord } from "./hotel";
import { cancellationTerms } from "./rules/cancellation";
import { taxCents, taxRateHundredths, type TaxRateInForce } from "./rules/pricing";

export interface StayRow extends Row {
  id: string;
  hotel_id: string;
  guest_id: string;
  rate_plan_id: string;
  guests: number;
  arrival: IsoDate;
  departure: IsoDate;
  status: StayStatus;
  version: number;
  checked_in_night: IsoDate | null;
  checked_in_online: boolean;
  online_full_name: string | null;
  online_phone: string | null;
  id_photo: boolean;
  link_state: LinkState;
  link_expires_at: Date | null;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
}

export interface NightRow extends Row {
  night: IsoDate;
  room_id: string;
  room_number: string;
  room_cents: number;
  city_tax_cents: number;
  tax_cents: number | null;
  posted: boolean;
}

const STAY_SELECT = `SELECT s.*, g.name AS guest_name, g.email AS guest_email, g.phone AS guest_phone
  FROM stays s JOIN guests g ON g.id = s.guest_id`;

export async function nightRows(from: Queryable, stayId: string): Promise<NightRow[]> {
  return rows<NightRow>(
    from,
    `SELECT n.night, n.room_id, r.number AS room_number, n.room_cents, n.city_tax_cents, n.tax_cents, n.posted
     FROM stay_nights n JOIN rooms r ON r.id = n.room_id WHERE n.stay_id = $1 ORDER BY n.night`,
    [stayId],
  );
}

/** One night as the API shows it: posted nights keep their posted tax, other nights follow the rate in force. */
export function nightView(night: NightRow, rates: readonly TaxRateInForce[]): Night {
  const tax = night.posted && night.tax_cents !== null ? night.tax_cents : taxCents(night.room_cents, taxRateHundredths(rates, night.night));
  return {
    date: night.night, roomNumber: night.room_number, roomCents: night.room_cents, taxCents: tax,
    cityTaxCents: night.city_tax_cents, totalCents: night.room_cents + tax + night.city_tax_cents, posted: night.posted,
  };
}

/** Consecutive nights in the same room make one block. */
export function segmentsOf(nights: readonly NightRow[]): Segment[] {
  const segments: Segment[] = [];
  for (const night of nights) {
    const last = segments[segments.length - 1];
    if (last && last.roomId === night.room_id) last.nights += 1;
    else segments.push({ roomId: night.room_id, roomNumber: night.room_number, firstNight: night.night, nights: 1 });
  }
  return segments;
}

interface FolioRow extends Row { id: string; name: string; payer_name: string; payer_email: string; state: "open" | "closed" }
export interface EntryRow extends Row {
  id: string; folio_id: string; kind: "charge" | "payment"; date: IsoDate; description: string; amount_cents: number;
  room_number: string | null; reverses_entry_id: string | null; split_of_entry_id: string | null;
}
interface InvoiceRow extends Row {
  id: string; folio_id: string; number: string; mail_state: "not_sent" | "sent"; bill_to_name: string; payer_email: string;
}

export function entryView(row: EntryRow): Entry {
  return {
    id: row.id, kind: row.kind, date: row.date, description: row.description, amountCents: row.amount_cents,
    roomNumber: row.room_number, reversesEntryId: row.reverses_entry_id, splitOfEntryId: row.split_of_entry_id,
  };
}

export function invoiceView(row: InvoiceRow): Invoice {
  return {
    id: row.id, number: row.number, state: "issued", mailState: row.mail_state, billToName: row.bill_to_name,
    payerEmail: row.payer_email, pdfUrl: `/api/invoices/${row.id}/pdf`,
  };
}

/** Balance is charges less payments. */
export function balanceOf(entries: readonly Entry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.kind === "charge" ? entry.amountCents : -entry.amountCents), 0);
}

export async function foliosOf(from: Queryable, stayId: string): Promise<Folio[]> {
  const folios = await rows<FolioRow>(from, "SELECT * FROM folios WHERE stay_id = $1 ORDER BY name", [stayId]);
  const ids = folios.map((folio) => folio.id);
  const entries = await rows<EntryRow>(from, "SELECT * FROM entries WHERE folio_id = ANY($1) ORDER BY seq", [ids]);
  const invoices = await rows<InvoiceRow>(from, "SELECT * FROM invoices WHERE folio_id = ANY($1)", [ids]);
  return folios.map((folio) => {
    const own = entries.filter((entry) => entry.folio_id === folio.id).map(entryView);
    const invoice = invoices.find((candidate) => candidate.folio_id === folio.id);
    return {
      id: folio.id, name: folio.name, payerName: folio.payer_name, payerEmail: folio.payer_email, state: folio.state,
      balanceCents: balanceOf(own), entries: own, invoice: invoice ? invoiceView(invoice) : null,
    };
  });
}

function linkStateOf(row: StayRow, now: Date): LinkState {
  if (row.link_state !== "sent") return row.link_state;
  return row.status !== "booked" || (row.link_expires_at !== null && now >= row.link_expires_at) ? "ended" : "sent";
}

export async function stayView(from: Queryable, hotel: HotelRecord, row: StayRow): Promise<Stay> {
  // One after the other: inside a transaction `from` is a single connection, which runs one query at a time.
  const nightsFound = await nightRows(from, row.id);
  const rates = await taxRatesOf(from, hotel.id);
  const folios = await foliosOf(from, row.id);
  const nightly = nightsFound.map((night) => nightView(night, rates));
  const now = hotelNow(hotel.clockNow);
  const cancellation: Cancellation | null = cancellationTerms(row.status, row.arrival, now, hotel.timeZone, nightly[0].totalCents);
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    guest: { id: row.guest_id, name: row.guest_name, email: row.guest_email, phone: row.guest_phone },
    ratePlanId: row.rate_plan_id,
    guests: row.guests,
    arrival: row.arrival,
    departure: row.departure,
    segments: segmentsOf(nightsFound),
    checkedInOnline: row.checked_in_online,
    onlineCheckIn: row.checked_in_online ? { fullName: row.online_full_name ?? "", phone: row.online_phone ?? "" } : null,
    checkinLinkState: linkStateOf(row, now),
    checkInNight: row.checked_in_night,
    idPhoto: row.id_photo ? "received" : "none",
    nightly,
    totalCents: nightly.reduce((sum, night) => sum + night.totalCents, 0),
    cancellation,
    folios,
  };
}

/** The stay a caller may open: this hotel's, or undefined. */
export async function findStay(from: Queryable, hotelId: string, stayId: string, lock = false): Promise<StayRow | undefined> {
  if (!isUuid(stayId)) return undefined;
  const found = await rows<StayRow>(from, `${STAY_SELECT} WHERE s.id = $1 AND s.hotel_id = $2${lock ? " FOR UPDATE OF s" : ""}`, [stayId, hotelId]);
  return found[0];
}

export async function loadStay(from: Queryable, hotelId: string, stayId: string): Promise<Stay | undefined> {
  const row = await findStay(from, hotelId, stayId);
  return row ? stayView(from, await loadHotel(from, hotelId), row) : undefined;
}
