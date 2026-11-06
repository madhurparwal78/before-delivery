import {
  type BookingRow,
  type Cell,
  DOCUMENT_LABELS,
  type DocumentRow,
  type HoldRow,
  type InvoiceRow,
  type Kitchen,
  type Quote,
  type Station,
} from "./domain.js";
import { clockOf, kitchenClock, kitchenDate, minutesOf } from "./kitchenTime.js";
import { dollars, hoursText } from "./money.js";
import { documentState, holdState } from "./rules.js";

// API objects exactly as the brief's Objects list names them.

export function kitchenView(kitchen: Kitchen, stations: Station[], now: Date, holdSeconds: number) {
  return {
    id: kitchen.id,
    name: kitchen.name,
    timezone: kitchen.timezone,
    today: kitchenDate(kitchen.timezone, now),
    server_now: now.toISOString(),
    same_day_cutoff: kitchen.same_day_cutoff,
    hold_seconds: holdSeconds,
    stations,
  };
}

export function holdView(hold: HoldRow, kitchen: Kitchen, now: Date, quote: Quote) {
  return {
    id: hold.id,
    member_id: hold.member_id,
    date: hold.date,
    state: holdState(hold, now),
    cells: hold.cells,
    expires_at: hold.expires_at.toISOString(),
    expires_local: kitchenClock(kitchen.timezone, hold.expires_at),
    server_now: now.toISOString(),
    quote,
  };
}

/** Each station's contiguous runs of cells, in loom order. */
export function blocksOf(cells: Cell[], stations: Station[]) {
  const blocks: { station_id: string; station: string; start: string; end: string; hours: string }[] = [];
  for (const station of stations) {
    const starts = cells
      .filter((c) => c.station_id === station.id)
      .map((c) => minutesOf(c.start))
      .sort((a, b) => a - b);
    let runStart = -1;
    let previous = -1;
    const close = (): void => {
      if (runStart < 0) return;
      const quarters = (previous + 15 - runStart) / 15;
      blocks.push({ station_id: station.id, station: station.name, start: clockOf(runStart), end: clockOf(previous + 15), hours: hoursText(quarters) });
    };
    for (const minutes of starts) {
      if (minutes !== previous + 15) {
        close();
        runStart = minutes;
      }
      previous = minutes;
    }
    close();
  }
  return blocks;
}

export function bookingView(booking: BookingRow, stations: Station[]) {
  return {
    id: booking.id,
    ref: booking.ref,
    member_id: booking.member_id,
    kitchen_id: booking.kitchen_id,
    date: booking.date,
    state: booking.state,
    cells: booking.cells,
    blocks: blocksOf(booking.cells, stations),
    starts_at: booking.starts_at.toISOString(),
    ends_at: booking.ends_at.toISOString(),
    quarters: booking.quarters,
    hours: hoursText(booking.quarters),
    lines: booking.lines,
    pack_quarters: booking.pack_quarters,
    total_cents: booking.total_cents,
    total: dollars(booking.total_cents),
    rate_card_id: booking.rate_card_id,
    cancellation_window_hours: booking.cancellation_window_hours,
    confirmed_at: booking.confirmed_at.toISOString(),
    invoice_id: booking.invoice_id,
    series_id: booking.series_id,
  };
}

export function invoiceView(invoice: InvoiceRow, billingAmounts: Map<string, number> | null) {
  const billing = invoice.killbill_invoice_id;
  return {
    id: invoice.id,
    ref: invoice.ref,
    member_id: invoice.member_id,
    kind: invoice.kind,
    booking_ids: invoice.booking_ids,
    lines: invoice.lines,
    total_cents: invoice.total_cents,
    total: dollars(invoice.total_cents),
    killbill_invoice_id: billing,
    billing_amount_cents: billing === null || billingAmounts === null ? null : (billingAmounts.get(billing) ?? null),
    issued_at: invoice.issued_at.toISOString(),
  };
}

export function documentView(doc: DocumentRow, today: string) {
  return {
    id: doc.id,
    member_id: doc.member_id,
    type: doc.type,
    label: DOCUMENT_LABELS[doc.type],
    state: documentState(doc, today),
    expires_on: doc.expires_on,
    original_name: doc.original_name,
    size_bytes: doc.size_bytes,
    content_type: doc.content_type,
    uploaded_at: doc.uploaded_at.toISOString(),
    reject_reason: doc.reject_reason,
  };
}
