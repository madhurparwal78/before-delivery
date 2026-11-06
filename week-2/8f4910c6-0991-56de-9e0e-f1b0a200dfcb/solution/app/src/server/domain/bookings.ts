// Bookings: the all-or-nothing confirm: Kill Bill draft invoice, booking, paired ledger movement, outbox
// emails and option changes together; and Issue invoice.

import type { PoolClient } from "pg";
import { exec, one, pool, rows, the, tx, type Db } from "../db.js";
import { memberRoute, json } from "../http.js";
import { FieldErrors, conflict, isoInstant, notFound, optionalInstant } from "../errors.js";
import { enqueue } from "../mail.js";
import { accountFor, billingClient, commitInvoice, draftInvoice, voidInvoice } from "../killbill.js";
import { calendar, escapeText, icsDate, icsStamp } from "../ics.js";
import { asObject, isWholeNumber, newId, nextCounter, str } from "../util.js";
import { formatDate, formatMoney, listJoin } from "../../shared/format.js";
import { addDays, isMonth, lastDayOfMonth, type OfficeId } from "../../shared/zones.js";
import { MAX_OVERTIME_MINUTES, USAGE_TERMS, isMedia, isTerritory, price, type Board, type FeeLine, type Priced,
  type PricedTalent, type RateCard, type UsageRow } from "./fees.js";
import { alreadyBooked, challengeOutcome, getOption, liveLadder, lockDay, optionById, takeOffLadder,
  type OptionRow } from "./options.js";
import { cardFor } from "./rate-cards.js";

interface BookingRow {
  id: string;
  reference: string;
  state: "confirmed" | "invoiced" | "corrected";
  job_date: string;
  office_id: OfficeId;
  client_id: string;
  client_company: string;
  job_title: string;
  rate_card_id: string;
  rate_card_name: string;
  rate_card_effective_from: string;
  talent_fees_cents: number;
  service_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  killbill_invoice_id: string;
  confirmed_by: string;
  confirmed_at: Date;
  issued_by: string | null;
  issued_at: Date | null;
}

const BOOKING_SELECT = `SELECT b.*, c.company AS client_company, r.name AS rate_card_name,
    r.effective_from AS rate_card_effective_from
  FROM bookings b JOIN clients c ON c.id = b.client_id JOIN rate_cards r ON r.id = b.rate_card_id`;

async function bookingBody(db: Db, row: BookingRow): Promise<Record<string, unknown>> {
  const talent = await rows<{ talent_id: string; display_name: string; talent_fees_cents: number;
    service_fee_share_cents: number }>(
    db,
    `SELECT bt.talent_id, t.display_name, bt.talent_fees_cents, bt.service_fee_share_cents
       FROM booking_talent bt JOIN talent t ON t.id = bt.talent_id WHERE bt.booking_id = $1 ORDER BY bt.position`,
    [row.id],
  );
  const lines = await rows<{ kind: FeeLine["kind"]; label: string; talent_id: string | null; amount_cents: number }>(
    db, "SELECT kind, label, talent_id, amount_cents FROM booking_lines WHERE booking_id = $1 ORDER BY position", [row.id]);
  return {
    id: row.id,
    reference: row.reference,
    state: row.state,
    date: row.job_date,
    office: row.office_id,
    clientId: row.client_id,
    clientCompany: row.client_company,
    jobTitle: row.job_title,
    rateCard: { id: row.rate_card_id, name: row.rate_card_name, effectiveFrom: row.rate_card_effective_from },
    talent: talent.map((t) => ({ talentId: t.talent_id, displayName: t.display_name, talentFeesCents: t.talent_fees_cents,
      serviceFeeShareCents: t.service_fee_share_cents })),
    lines: lines.map((l) => ({ kind: l.kind, label: l.label, talentId: l.talent_id, amountCents: l.amount_cents })),
    talentFeesCents: row.talent_fees_cents,
    serviceFeeCents: row.service_fee_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    killbillInvoiceId: row.killbill_invoice_id,
    confirmedBy: row.confirmed_by,
    confirmedAt: isoInstant(row.confirmed_at),
    issuedBy: row.issued_by,
    issuedAt: optionalInstant(row.issued_at),
  };
}

async function bookingById(db: Db, id: string): Promise<BookingRow | null> {
  return one<BookingRow>(db, `${BOOKING_SELECT} WHERE b.id = $1`, [id]);
}

async function bookingReply(db: Db, id: string, status: number) {
  const row = await bookingById(db, id);
  if (!row) throw new Error(`booking ${id} vanished`);
  return json(status, { booking: await bookingBody(db, row) });
}

interface ConfirmRow {
  optionId: string;
  dayType: unknown;
  overtimeMinutes: unknown;
  usage: unknown;
}

function readRows(value: unknown): ConfirmRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return null;
  return value.map((item) => {
    const row = asObject(item);
    return { optionId: str(row, "optionId"), dayType: row.dayType, overtimeMinutes: row.overtimeMinutes, usage: row.usage };
  });
}

function readUsage(value: unknown): UsageRow[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const usage: UsageRow[] = [];
  for (const item of value) {
    const row = asObject(item);
    const { media, territory, termMonths } = row;
    if (!isMedia(media) || !isTerritory(territory) || !isWholeNumber(termMonths) || !USAGE_TERMS.includes(termMonths)) {
      return null;
    }
    usage.push({ media, territory, termMonths });
  }
  return usage;
}

function confirmationEmail(booking: { reference: string; jobTitle: string; date: string; rateCardName: string },
  names: string[], lines: FeeLine[], totalCents: number, now: number): { text: string; ics: string } {
  const text = [
    `Booking ${booking.reference} is confirmed.`,
    "",
    `Job: ${booking.jobTitle}`,
    `Day: ${formatDate(booking.date)}`,
    `Talent: ${listJoin(names)}`,
    `Rate card: ${booking.rateCardName}`,
    "",
    "Fees:",
    ...lines.map((line) => `${line.label}: ${formatMoney(line.amountCents)}`),
    "",
    `Total: ${formatMoney(totalCents)}`,
    "",
    "The calendar file for the day is attached.",
    "",
    "Vesper & Rowe Talent",
  ].join("\n");
  const ics = calendar([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vesper & Rowe Talent//Rungboard//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:booking-${booking.reference}@rungboard.vesperrowe.example`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART;VALUE=DATE:${icsDate(booking.date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(booking.date, 1))}`,
    `SUMMARY:${escapeText(`${booking.jobTitle}: ${listJoin(names)}`)}`,
    `DESCRIPTION:${escapeText(`Total ${formatMoney(totalCents)}`)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
  return { text, ics };
}

async function lockAll(client: PoolClient, found: OptionRow[]): Promise<OptionRow[]> {
  const keys = [...new Set(found.map((row) => `${row.talent_id} ${row.job_date}`))].sort();
  for (const key of keys) {
    const [talentId, date] = key.split(" ");
    await lockDay(client, talentId, date);
  }
  return Promise.all(found.map((row) => getOption(client, row.id)));
}

/** Writes the confirmed booking; Kill Bill's draft invoice already exists. */
async function recordBooking(client: PoolClient, options: OptionRow[], group: PricedTalent[], priced: Priced,
  card: RateCard, invoiceId: string, actor: { id: string; name: string }, now: number): Promise<string> {
  const first = options[0];
  const id = newId();
  const reference = `VR-${first.job_date.slice(0, 4)}-${String(await nextCounter(client, `booking:${first.job_date.slice(0, 4)}`)).padStart(4, "0")}`;
  await exec(
    client,
    `INSERT INTO bookings (id, reference, state, job_date, office_id, client_id, job_title, rate_card_id, talent_fees_cents,
       service_fee_cents, tax_cents, total_cents, killbill_invoice_id, confirmed_by, confirmed_at)
     VALUES ($1, $2, 'confirmed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, reference, first.job_date, first.office_id, first.client_id, first.job_title, card.id, priced.talentFeesCents,
      priced.serviceFeeCents, priced.taxCents, priced.totalCents, invoiceId, actor.name, new Date(now)],
  );
  for (const [position, share] of priced.talent.entries()) {
    await exec(client, `INSERT INTO booking_talent (booking_id, position, talent_id, option_id, talent_fees_cents,
      service_fee_share_cents) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, position, share.talentId, options[position].id, share.talentFeesCents, share.serviceFeeShareCents]);
  }
  for (const [position, line] of priced.lines.entries()) {
    await exec(client, `INSERT INTO booking_lines (booking_id, position, kind, label, talent_id, amount_cents)
      VALUES ($1, $2, $3, $4, $5, $6)`, [id, position, line.kind, line.label, line.talentId, line.amountCents]);
  }
  const movement = newId();
  await exec(
    client,
    `INSERT INTO movements (id, kind, reference, talent_id, booking_id, note, created_by, created_at, office_date)
     VALUES ($1, 'booking', $2, $3, $4, $5, $6, $7, $8)`,
    [movement, reference, first.talent_id, id, first.job_title, actor.name, new Date(now), first.job_date],
  );
  const entries: Array<[string, number]> = [
    ...priced.talent.map((share): [string, number] => [`talent:${share.talentId}`, share.talentFeesCents]),
    ["agency_fees", priced.serviceFeeCents],
    ["tax_payable", priced.taxCents],
    [`client:${first.client_id}`, -priced.totalCents],
  ];
  for (const [position, [account, amount]] of entries.entries()) {
    await exec(client, "INSERT INTO entries (movement_id, position, account, amount_cents) VALUES ($1, $2, $3, $4)",
      [movement, position, account, amount]);
  }
  for (const option of options) {
    const live = await liveLadder(client, option.talent_id, option.job_date);
    const challenger = live.find((row) => row.rank === 2);
    await exec(client, `UPDATE options SET state = 'confirmed', booking_id = $2, version = version + 1,
      sequence = sequence + 1, saved_by = $3, saved_at = $4 WHERE id = $1`, [option.id, id, actor.name, new Date(now)]);
    if (option.state === "challenged" && challenger) {
      await challengeOutcome(client, option, challenger, "Your 1st option is confirmed.", "This day is now booked.");
    }
    for (const other of live.filter((row) => row.id !== option.id)) {
      await takeOffLadder(client, await getOption(client, other.id), "released", "day_booked", actor.name, now);
    }
  }
  const contact = await the<{ contact_email: string }>(client, "SELECT contact_email FROM clients WHERE id = $1",
    [first.client_id]);
  const mail = confirmationEmail({ reference, jobTitle: first.job_title, date: first.job_date, rateCardName: card.name },
    group.map((row) => row.displayName), priced.lines, priced.totalCents, now);
  await enqueue(client, {
    to: contact.contact_email,
    subject: `Booking confirmed: ${first.job_title} on ${formatDate(first.job_date)}`,
    text: mail.text,
    attachments: [{ filename: `booking-${reference}.ics`, contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      content: mail.ics }],
    talentIds: group.map((row) => row.talentId),
  });
  return id;
}

memberRoute("POST", "/api/bookings", async (ctx) => {
  ctx.allow("booker", "agency_director");
  const body = asObject(await ctx.json());
  const requested = readRows(body.options);
  let invoiceId: string | null = null;
  try {
    return await tx(async (client) => {
      const found = requested ? await Promise.all(requested.map((row) => optionById(client, row.optionId))) : [];
      const options = await lockAll(client, found.filter((row): row is OptionRow => row !== null));
      for (const option of options) {
        if (option.state === "released" || option.state === "expired") {
          throw conflict("option_released", { releasedAt: optionalInstant(option.released_at) });
        }
        if (option.state === "confirmed") throw await alreadyBooked(client, option);
        if (option.rank !== 1) throw conflict("not_first");
        if (option.state === "challenged" && option.challenge_deadline && option.challenge_deadline.getTime() <= ctx.now) {
          throw conflict("challenge_expired", { challengeDeadline: isoInstant(option.challenge_deadline) });
        }
      }
      const errors: FieldErrors = new FieldErrors();
      if (!requested || options.length !== requested.length) {
        errors.add("options", "Choose 1st options that are still on the board.");
        errors.fail();
      }
      const first = options[0];
      if (options.some((o) => o.client_id !== first.client_id || o.job_date !== first.job_date || o.office_id !== first.office_id)
        || new Set(options.map((o) => o.talent_id)).size !== options.length) {
        errors.add("options", "A group confirm needs 1st options of one client, day and office, for different talent.");
      }
      const group: PricedTalent[] = [];
      for (const [index, row] of requested.entries()) {
        const option = options[index];
        const dayType = row.dayType === "full_day" || row.dayType === "half_day" ? row.dayType : null;
        if (!dayType) errors.add("dayType", "Choose full day or half day.");
        const overtime = row.overtimeMinutes ?? 0;
        const minutes = isWholeNumber(overtime) && overtime >= 0 && overtime <= MAX_OVERTIME_MINUTES ? overtime : null;
        if (minutes === null) errors.add("overtimeMinutes", "Enter overtime as whole minutes from 0 to 600.");
        const usage = readUsage(row.usage);
        if (!usage) errors.add("usage", "Choose a media, territory and term for each usage line.");
        const talent = await the<{ display_name: string; board: Board }>(client,
          "SELECT display_name, board FROM talent WHERE id = $1", [option.talent_id]);
        if (dayType && minutes !== null && usage) {
          group.push({ talentId: option.talent_id, displayName: talent.display_name, board: talent.board, dayType,
            overtimeMinutes: minutes, usage });
        }
      }
      errors.throwIfAny();
      const card = await cardFor(client, first.job_date);
      const priced = price(card, first.office_id, group);
      const account = await accountFor(client, await billingClient(client, first.client_id));
      invoiceId = await draftInvoice(account, priced.lines.map((line) => ({ description: line.label,
        amountCents: line.amountCents })));
      const id = await recordBooking(client, options, group, priced, card, invoiceId, ctx.member, ctx.now);
      return bookingReply(client, id, 201);
    });
  } catch (error) {
    if (invoiceId) await voidInvoice(invoiceId).catch((e: Error) => console.error("void failed:", e.message));
    throw error;
  }
});

memberRoute("GET", "/api/bookings", async (ctx) => {
  ctx.allow("booker", "accounts_lead", "agency_director");
  const office = ctx.query.get("office") || null;
  const month = ctx.query.get("month") || null;
  const errors: FieldErrors = new FieldErrors();
  if (office !== null && office !== "toronto" && office !== "vancouver") errors.add("office", "Choose Toronto or Vancouver.");
  if (month !== null && !isMonth(month)) errors.add("month", "Choose a month like 2027-03.");
  errors.throwIfAny();
  const found = await rows<BookingRow>(
    pool,
    `${BOOKING_SELECT} WHERE ($1::text IS NULL OR b.office_id = $1)
       AND ($2::date IS NULL OR (b.job_date >= $2::date AND b.job_date <= $3::date))
     ORDER BY b.job_date DESC, b.reference DESC LIMIT 500`,
    [office, month ? `${month}-01` : null, month ? lastDayOfMonth(month) : null],
  );
  return json(200, { bookings: await Promise.all(found.map((row) => bookingBody(pool, row))) });
});

async function visibleBooking(id: string, talentMember: boolean): Promise<BookingRow> {
  const row = talentMember ? null : await bookingById(pool, id);
  if (!row) throw notFound();
  return row;
}

memberRoute("GET", "/api/bookings/:id", async (ctx) => {
  const row = await visibleBooking(ctx.params.id, ctx.isTalent());
  ctx.allow("booker", "accounts_lead", "agency_director");
  return json(200, { booking: await bookingBody(pool, row) });
});

memberRoute("POST", "/api/bookings/:id/issue", async (ctx) => {
  await visibleBooking(ctx.params.id, ctx.isTalent());
  ctx.allow("accounts_lead", "agency_director");
  await ctx.json();
  return tx(async (client) => {
    const row = await one<BookingRow>(client, `${BOOKING_SELECT} WHERE b.id = $1 FOR UPDATE OF b`, [ctx.params.id]);
    if (!row) throw notFound();
    if (row.state !== "confirmed") {
      throw conflict("already_invoiced", { issuedBy: row.issued_by, issuedAt: optionalInstant(row.issued_at) });
    }
    await commitInvoice(row.killbill_invoice_id);
    await exec(client, "UPDATE bookings SET state = 'invoiced', issued_by = $2, issued_at = $3 WHERE id = $1",
      [row.id, ctx.member.name, new Date(ctx.now)]);
    return bookingReply(client, row.id, 200);
  });
});
