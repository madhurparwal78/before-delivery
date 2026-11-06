import { randomUUID } from "node:crypto";
import { audit, type Client } from "./db.js";
import type { BookingRow, Cell, InvoiceRow, Kitchen, Member, Quote, RateCard, Station, User } from "./domain.js";
import { confirmationEmail } from "./emails.js";
import { type PostedInvoice, postCharges, reverseInvoice } from "./killbill.js";
import { clockOf, minutesOf, toInstant } from "./kitchenTime.js";
import { stage } from "./mail.js";
import { hoursText } from "./money.js";

// The confirm unit shared by a single confirm and a weekly series: bookings, pack draws, one
// invoice, one billing invoice and one email, inside the caller's transaction. SMTP accepting the
// email is the last step before the caller commits; if it refuses, the billing invoice is reversed.

export interface Occurrence {
  date: string;
  cells: Cell[];
  quote: Quote;
}

interface SeriesRecord {
  id: string;
  weekday: string;
  start: string;
  end: string;
  station_ids: string[];
  weeks: number;
}

export const newId = (prefix: string): string => `${prefix}-${randomUUID()}`;

export async function nextRef(client: Client, sequence: "booking_ref_seq" | "invoice_ref_seq", prefix: string): Promise<string> {
  const found = await client.query<{ n: string }>(`SELECT nextval('${sequence}') AS n`);
  return `${prefix}-${String(found.rows[0]?.n ?? "0").padStart(6, "0")}`;
}

export async function recordMovement(
  client: Client,
  memberId: string,
  kind: "purchase" | "draw" | "refund",
  quarters: number,
  bookingId: string | null,
  reverses: string | null,
  now: Date,
): Promise<string> {
  const id = newId("mv");
  const pair: Record<typeof kind, [string, number, string, number]> = {
    purchase: ["member_pack", quarters, "pack_sales", -quarters],
    draw: ["member_pack", -quarters, "hours_used", quarters],
    refund: ["member_pack", quarters, "hours_used", -quarters],
  };
  const [a, qa, b, qb] = pair[kind];
  await client.query(
    "INSERT INTO movements (id, member_id, kind, quarters, booking_id, reverses, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, memberId, kind, quarters, bookingId, reverses, now],
  );
  await client.query("INSERT INTO entries (movement_id, account, quarters) VALUES ($1,$2,$3), ($1,$4,$5)", [id, a, qa, b, qb]);
  return id;
}

export async function bookOccurrences(args: {
  client: Client;
  actor: User;
  kitchen: Kitchen;
  stations: Station[];
  member: Member;
  card: RateCard;
  occurrences: Occurrence[];
  holdId: string | null;
  series: SeriesRecord | null;
  now: Date;
}): Promise<{ bookings: BookingRow[]; invoice: InvoiceRow; billingAmountCents: number | null }> {
  const { client, actor, kitchen, stations, member, card, occurrences, holdId, series, now } = args;
  if (series) {
    await client.query(
      `INSERT INTO series (id, kitchen_id, member_id, weekday, start, "end", station_ids, weeks, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [series.id, kitchen.id, member.id, series.weekday, series.start, series.end, JSON.stringify(series.station_ids), series.weeks, now],
    );
  }
  const invoiceId = newId("inv");
  const invoiceRef = await nextRef(client, "invoice_ref_seq", "INV");
  const bookings: BookingRow[] = [];
  for (const occurrence of occurrences) {
    const starts = occurrence.cells.map((c) => minutesOf(c.start));
    const booking: BookingRow = {
      id: newId("bk"),
      ref: await nextRef(client, "booking_ref_seq", "PL"),
      kitchen_id: kitchen.id,
      member_id: member.id,
      hold_id: holdId,
      series_id: series?.id ?? null,
      date: occurrence.date,
      state: "confirmed",
      cells: occurrence.cells,
      starts_at: toInstant(kitchen.timezone, occurrence.date, clockOf(Math.min(...starts))),
      ends_at: toInstant(kitchen.timezone, occurrence.date, clockOf(Math.max(...starts) + 15)),
      quarters: occurrence.cells.length,
      lines: occurrence.quote.lines,
      pack_quarters: occurrence.quote.pack_quarters,
      total_cents: occurrence.quote.total_cents,
      rate_card_id: card.id,
      cancellation_window_hours: card.cancellation_window_hours,
      confirmed_at: now,
      invoice_id: invoiceId,
      refund_cents: 0,
      cancelled_at: null,
    };
    bookings.push(booking);
  }
  const invoice: InvoiceRow = {
    id: invoiceId,
    ref: invoiceRef,
    kitchen_id: kitchen.id,
    member_id: member.id,
    kind: series ? "series" : "booking",
    booking_ids: bookings.map((b) => b.id),
    lines: bookings.flatMap((b) => b.lines),
    total_cents: bookings.reduce((sum, b) => sum + b.total_cents, 0),
    killbill_invoice_id: null,
    issued_at: now,
  };
  await client.query(
    `INSERT INTO invoices (id, ref, kitchen_id, member_id, kind, booking_ids, lines, total_cents, killbill_invoice_id, issued_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9)`,
    [invoice.id, invoice.ref, kitchen.id, member.id, invoice.kind, JSON.stringify(invoice.booking_ids), JSON.stringify(invoice.lines),
      invoice.total_cents, now],
  );
  for (const b of bookings) {
    await client.query(
      `INSERT INTO bookings (id, ref, kitchen_id, member_id, hold_id, series_id, date, state, cells, starts_at, ends_at, quarters,
         lines, pack_quarters, total_cents, rate_card_id, cancellation_window_hours, confirmed_at, invoice_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [b.id, b.ref, b.kitchen_id, b.member_id, b.hold_id, b.series_id, b.date, JSON.stringify(b.cells), b.starts_at, b.ends_at,
        b.quarters, JSON.stringify(b.lines), b.pack_quarters, b.total_cents, b.rate_card_id, b.cancellation_window_hours, now, invoiceId],
    );
    if (b.pack_quarters > 0) await recordMovement(client, member.id, "draw", b.pack_quarters, b.id, null, now);
    await audit(client, actor.id, "booking", b.id, null, "confirmed", now);
  }

  const charges = bookings.flatMap((b) =>
    b.lines
      .filter((l) => l.paid_by === "cash" && l.amount_cents > 0)
      .map((l) => ({ amountCents: l.amount_cents, description: `${b.ref} · ${l.station} · tier ${l.tier} · ${hoursText(l.quarters)} h` })),
  );
  const email = await stage(confirmationEmail(kitchen, member, bookings, stations));
  let posted: PostedInvoice | null = null;
  try {
    if (charges.length > 0) {
      posted = await postCharges(client, member, charges);
      invoice.killbill_invoice_id = posted.invoiceId;
      await client.query("UPDATE invoices SET killbill_invoice_id = $1 WHERE id = $2", [posted.invoiceId, invoice.id]);
    }
  } catch (error) {
    email.abandon();
    throw error;
  }
  try {
    await email.accept();
  } catch (error) {
    if (posted) await reverseInvoice(posted, charges.map((c) => c.amountCents)).catch(() => undefined);
    throw error;
  }
  return { bookings, invoice, billingAmountCents: posted?.amountCents ?? null };
}
