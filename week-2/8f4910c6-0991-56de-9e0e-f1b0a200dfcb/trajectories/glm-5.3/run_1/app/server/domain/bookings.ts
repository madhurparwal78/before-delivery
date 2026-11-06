import { withTransaction, one, type Tx, type Reader } from "../db.js";
import { errors } from "../http/errors.js";
import { randomToken, OFFICE_META, type Office } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { formatDay, formatMoney } from "../../shared/format.js";
import { talentFeeLines, serviceFeeCents, splitServiceFee, taxLines, type FeeLine, type RateCard } from "./fees.js";
import { queueEmail } from "./outbox.js";
import { createOrGetAccount, createDraftInvoice, commitInvoice, voidInvoice, BillingOutage } from "./killbill.js";
import { reladder, liveStates, type OptionRow } from "./ladder.js";
import { icsForBooking } from "./feeds.js";
import type { SessionMember } from "./sessions.js";

export interface BookingRow {
  id: string;
  reference: string;
  state: string;
  date: string;
  office: string;
  client_id: string;
  job_title: string;
  rate_card_id: string;
  talent_fees_cents: number;
  service_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  killbill_invoice_id: string | null;
  confirmed_by: string;
  confirmed_at: Date;
  issued_by: string | null;
  issued_at: Date | null;
}

export interface ConfirmOptionInput {
  optionId: string;
  dayType: "full_day" | "half_day";
  overtimeMinutes: number;
  usage: Array<{ media: string; territory: string; termMonths: number }>;
}

export async function rateCardIdFor(tx: Tx, date: string | Date): Promise<{ id: string; name: string; effectiveFrom: string }> {
  const row = await tx.one<{ id: string; name: string; effective_from: string }>(
    `SELECT id, name, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM rate_cards WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1`,
    [date]
  );
  if (!row) throw new Error("no rate card in effect");
  return { id: row.id, name: row.name, effectiveFrom: row.effective_from };
}

export async function loadRateCard(tx: Tx, id: string): Promise<RateCard> {
  const card = await tx.one<{ id: string; name: string; effective_from: string }>(
    `SELECT id, name, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM rate_cards WHERE id = $1`,
    [id]
  );
  if (!card) throw new Error("rate card missing");
  const boards = await tx.query<{ board: string; full_day_cents: number; half_day_cents: number; overtime_qh_cents: number }>(
    `SELECT board, full_day_cents, half_day_cents, overtime_qh_cents FROM rate_card_boards WHERE rate_card_id = $1`,
    [id]
  );
  const usage = await tx.query<{ media: string; base_cents: number }>(`SELECT media, base_cents FROM rate_card_usage WHERE rate_card_id = $1`, [id]);
  return {
    id: card.id,
    name: card.name,
    effectiveFrom: card.effective_from,
    boards: Object.fromEntries(boards.map((b) => [b.board, { fullDayCents: b.full_day_cents, halfDayCents: b.half_day_cents, overtimeQuarterHourCents: b.overtime_qh_cents }])) as RateCard["boards"],
    usageBaseCents: Object.fromEntries(usage.map((u) => [u.media, u.base_cents])) as RateCard["usageBaseCents"],
  };
}

export interface ConfirmInput {
  options: ConfirmOptionInput[];
  member: SessionMember;
  now: Date;
}

export interface ConfirmOutcome {
  booking: BookingRow;
  talentNames: string[];
}

/** Confirms a group of 1st options: prices fees, writes Kill Bill draft, booking, ledger, email and option states together. */
export async function confirmBooking(tx: Tx, input: ConfirmInput): Promise<ConfirmOutcome> {
  const { options } = input;
  if (options.length === 0) throw errors.validation({ options: "Confirm at least one option." });
  const loaded: Array<{ option: OptionRow & { client_company: string; office: string }; item: ConfirmOptionInput }> = [];
  for (const item of options) {
    const option = await tx.one<OptionRow & { client_company: string; office: string }>(
      `SELECT o.*, c.company AS client_company, t.office AS office
       FROM options o JOIN clients c ON c.id = o.client_id JOIN talent t ON t.id = o.talent_id WHERE o.id = $1`,
      [item.optionId]
    );
    if (!option) throw errors.notFound();
    loaded.push({ option, item });
  }
  const first = loaded[0].option;
  const groupError = errors.validation({ options: "A group confirm needs every option to be a 1st option for the same client, day and office, for distinct talent." });
  if (new Set(loaded.map((l) => l.option.client_id)).size > 1 || new Set(loaded.map((l) => l.option.date)).size > 1 || new Set(loaded.map((l) => l.option.office)).size > 1) {
    throw groupError;
  }
  if (new Set(loaded.map((l) => l.option.talent_id)).size !== loaded.length) {
    throw groupError;
  }
  for (const { option } of loaded) {
    void isoDate;
    if (option.state === "confirmed") {
      const booking = option.booked_booking_id
        ? await tx.one<{ confirmed_by: string; confirmed_at: Date; confirmed_by_name: string }>(
            `SELECT b.confirmed_by, b.confirmed_at, m.name AS confirmed_by_name FROM bookings b JOIN members m ON m.id = b.confirmed_by WHERE b.id = $1`,
            [option.booked_booking_id]
          )
        : null;
      throw errors.conflict("already_booked", {
        bookedBy: booking?.confirmed_by_name || "A booker",
        bookedAt: toInstant(booking?.confirmed_at || input.now),
        bookingId: option.booked_booking_id || "",
      });
    }
    if (option.state === "released" || option.state === "expired") {
      throw errors.conflict("option_released", { releasedAt: toInstant(option.released_at || input.now) });
    }
    if (option.challenge_deadline && option.challenge_deadline.getTime() <= input.now.getTime()) {
      throw errors.conflict("challenge_expired", { challengeDeadline: toInstant(option.challenge_deadline) });
    }
    if (option.rank !== 1) throw errors.conflict("not_first");
  }
  for (const { item } of loaded) {
    if (!Number.isInteger(item.overtimeMinutes) || item.overtimeMinutes < 0 || item.overtimeMinutes > 600) {
      throw errors.validation({ options: "Overtime minutes must be a whole number from 0 to 600." });
    }
    if (item.dayType !== "full_day" && item.dayType !== "half_day") {
      throw errors.validation({ options: "Day type must be full day or half day." });
    }
    for (const usage of item.usage) {
      if (![3, 6, 12].includes(usage.termMonths)) throw errors.validation({ options: "Term must be 3, 6 or 12 months." });
      if (!["digital", "print", "out_of_home", "broadcast"].includes(usage.media)) throw errors.validation({ options: "Media must be Digital, Print, Out of home or Broadcast." });
      if (!["canada", "north_america", "worldwide"].includes(usage.territory)) throw errors.validation({ options: "Territory must be Canada, North America or Worldwide." });
    }
  }
  const client = await tx.one<{ id: string; slug: string; company: string; contact_email: string; contact_name: string }>(`SELECT * FROM clients WHERE id = $1`, [first.client_id]);
  if (!client) throw errors.notFound();
  const cardMeta = await rateCardIdFor(tx, first.date);
  const card = await loadRateCard(tx, cardMeta.id);
  const office = first.office as Office;
  const lines: FeeLine[] = [];
  const feeByTalent: Record<string, number> = {};
  const talentOrder: string[] = [];
  const names: string[] = [];
  for (const { option, item } of loaded) {
    const talent = await tx.one<{ board: string; display_name: string; state: string }>(`SELECT board, display_name, state FROM talent WHERE id = $1`, [option.talent_id]);
    if (!talent || talent.state === "erased") throw errors.notFound();
    const talentLines = talentFeeLines(option.talent_id, {
      displayName: talent.display_name,
      board: talent.board as never,
      dayType: item.dayType,
      overtimeMinutes: item.overtimeMinutes,
      usage: item.usage as never,
    }, card);
    lines.push(...talentLines);
    feeByTalent[option.talent_id] = talentLines.reduce((a, l) => a + l.amountCents, 0);
    talentOrder.push(option.talent_id);
    names.push(talent.display_name);
  }
  const talentFeesTotal = Object.values(feeByTalent).reduce((a, b) => a + b, 0);
  const serviceFee = serviceFeeCents(talentFeesTotal);
  const shares = splitServiceFee(serviceFee, talentOrder, feeByTalent);
  const taxes = taxLines(office, talentFeesTotal + serviceFee);
  lines.push({ kind: "service_fee", label: "Agency service fee 20%", talentId: "", amountCents: serviceFee });
  lines.push(...taxes);
  const taxTotal = taxes.reduce((a, l) => a + l.amountCents, 0);
  const total = talentFeesTotal + serviceFee + taxTotal;
  const reference = await nextBookingReference(tx);
  const bookingId = `bkg_${randomToken(12)}`;
  const dayText = isoDate(first.date);

  let killbillInvoiceId: string | null = null;
  try {
    const account = await createOrGetAccount(`rungboard-client-${client.slug}`, client.company, client.contact_email);
    const invoice = await createDraftInvoice(account.accountId, lines.map((l) => ({ description: l.label, amountCents: l.amountCents })));
    killbillInvoiceId = invoice.invoiceId;
  } catch (err) {
    if (err instanceof BillingOutage) throw errors.billingUnavailable();
    throw err;
  }

  try {
    const officeDate = officeDateFor(office, input.now);
    await tx.query(
      `INSERT INTO bookings (id, reference, state, date, office, client_id, job_title, rate_card_id, talent_fees_cents, service_fee_cents, tax_cents, total_cents, killbill_invoice_id, confirmed_by, confirmed_at)
       VALUES ($1, $2, 'confirmed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [bookingId, reference, dayText, office, client.id, first.job_title || "Booking", cardMeta.id, talentFeesTotal, serviceFee, taxTotal, total, killbillInvoiceId, input.member.id, input.now]
    );
    for (const talentId of talentOrder) {
      await tx.query(`INSERT INTO booking_talent (booking_id, talent_id, talent_fees_cents, service_fee_share_cents) VALUES ($1, $2, $3, $4)`, [bookingId, talentId, feeByTalent[talentId], shares[talentId] || 0]);
    }
    let position = 0;
    for (const line of lines) {
      await tx.query(`INSERT INTO booking_lines (id, booking_id, kind, label, talent_id, amount_cents, position) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        `bl_${randomToken(10)}`,
        bookingId,
        line.kind,
        line.label,
        line.talentId || null,
        line.amountCents,
        position++,
      ]);
    }
    await writeBookingLedger(tx, bookingId, reference, officeDate, input.member, input.now, feeByTalent, serviceFee, taxTotal, total, client.id);
    for (const { option } of loaded) {
      await tx.query(`UPDATE options SET state = 'confirmed', booked_booking_id = $2, challenge_deadline = NULL, rank = 1, version = version + 1 WHERE id = $1`, [option.id, bookingId]);
      const others = await tx.query<OptionRow>(`SELECT * FROM options WHERE talent_id = $1 AND date = $2::date AND id <> $3`, [option.talent_id, dayText, option.id]);
      for (const other of others) {
        if (liveStates().includes(other.state)) {
          await tx.query(`UPDATE options SET state = 'released', released_at = $2, release_reason = 'day_booked', rank = NULL, version = version + 1 WHERE id = $1`, [other.id, input.now]);
        }
      }
      await reladder(tx, option.talent_id, dayText);
    }
    const talentNames = names.join(", ");
    const body = [
      `Hello,`,
      ``,
      `Your booking is confirmed.`,
      ``,
      `Job: ${first.job_title || "Booking"}`,
      `Day: ${formatDay(dayText)}`,
      `Talent: ${talentNames}`,
      ``,
      `Fee lines:`,
      ...lines.map((l) => `${l.label} — ${formatMoney(l.amountCents)}`),
      ``,
      `Total: ${formatMoney(total)}`,
      `Rate card: ${cardMeta.name}`,
      ``,
      `Vesper & Rowe Talent`,
    ].join("\r\n");
    const ics = icsForBooking(reference, dayText, first.job_title || "Booking", talentNames, total);
    await queueEmail({
      to: client.contact_email,
      subject: `Booking confirmed: ${first.job_title || "Booking"} on ${formatDay(dayText)}`,
      body,
      attachmentName: `booking-${reference}.ics`,
      attachmentContent: ics,
    });
    const row = await tx.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    if (!row) throw new Error("booking missing after insert");
    return { booking: row, talentNames: names };
  } catch (err) {
    if (killbillInvoiceId) await voidInvoice(killbillInvoiceId).catch(() => {});
    throw err;
  }
}

export function officeDateFor(office: string, instant: Date): string {
  const tz = OFFICE_META[office as Office].timeZone;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

async function writeBookingLedger(
  tx: Tx,
  bookingId: string,
  reference: string,
  officeDate: string,
  member: SessionMember,
  now: Date,
  feeByTalent: Record<string, number>,
  serviceFee: number,
  taxTotal: number,
  total: number,
  clientId: string
): Promise<void> {
  const movementId = `mov_${randomToken(12)}`;
  await tx.query(
    `INSERT INTO ledger_movements (id, kind, reference, talent_id, booking_id, created_by, created_at, office_date)
     VALUES ($1, 'booking', $2, NULL, $3, $4, $5, $6)`,
    [movementId, reference, bookingId, member.id, now, officeDate]
  );
  const entries: Array<[string, number]> = [];
  for (const [talentId, fees] of Object.entries(feeByTalent)) entries.push([`talent:${talentId}`, fees]);
  entries.push(["agency_fees", serviceFee]);
  entries.push(["tax_payable", taxTotal]);
  entries.push([`client:${clientId}`, -total]);
  for (const [account, amount] of entries) {
    await tx.query(`INSERT INTO ledger_entries (id, movement_id, account, amount_cents) VALUES ($1, $2, $3, $4)`, [`le_${randomToken(10)}`, movementId, account, amount]);
  }
}

export async function nextBookingReference(tx: Tx): Promise<string> {
  await tx.query(`INSERT INTO counters (name, value) VALUES ('booking_reference', 0) ON CONFLICT DO NOTHING`);
  const row = await tx.one<{ value: number }>(`UPDATE counters SET value = value + 1 WHERE name = 'booking_reference' RETURNING value`);
  const n = row ? row.value : 1;
  const year = new Date().getUTCFullYear();
  return `VR-${year}-${String(n).padStart(4, "0")}`;
}

export async function loadBooking(id: string): Promise<BookingRow> {
  const row = await one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  return row;
}

export async function bookingView(read: Reader, row: BookingRow): Promise<Record<string, unknown>> {
  const card = await read.one<{ id: string; name: string; effective_from: string }>(`SELECT id, name, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM rate_cards WHERE id = $1`, [row.rate_card_id]);
  const talent = await read.query<{ talent_id: string; talent_fees_cents: number; service_fee_share_cents: number; display_name: string }>(
    `SELECT bt.talent_id, bt.talent_fees_cents, bt.service_fee_share_cents, t.display_name FROM booking_talent bt JOIN talent t ON t.id = bt.talent_id WHERE bt.booking_id = $1`,
    [row.id]
  );
  const lines = await read.query<{ kind: string; label: string; talent_id: string | null; amount_cents: number }>(
    `SELECT kind, label, talent_id, amount_cents FROM booking_lines WHERE booking_id = $1 ORDER BY position`,
    [row.id]
  );
  const client = await read.one<{ company: string }>(`SELECT company FROM clients WHERE id = $1`, [row.client_id]);
  const confirmedBy = await read.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.confirmed_by]);
  const issuedBy = row.issued_by ? await read.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.issued_by]) : null;
  return {
    id: row.id,
    reference: row.reference,
    state: row.state,
    date: iso(row.date),
    office: row.office,
    clientId: row.client_id,
    clientCompany: client?.company || "",
    jobTitle: row.job_title,
    rateCard: { id: card?.id || "", name: card?.name || "", effectiveFrom: card?.effective_from || "" },
    talent: talent.map((t) => ({ talentId: t.talent_id, displayName: t.display_name, talentFeesCents: t.talent_fees_cents, serviceFeeShareCents: t.service_fee_share_cents })),
    lines: lines.map((l) => ({ kind: l.kind, label: l.label, talentId: l.talent_id, amountCents: l.amount_cents })),
    talentFeesCents: row.talent_fees_cents,
    serviceFeeCents: row.service_fee_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    killbillInvoiceId: row.killbill_invoice_id,
    confirmedBy: { id: row.confirmed_by, name: confirmedBy?.name || "" },
    confirmedAt: toInstant(row.confirmed_at),
    issuedBy: issuedBy ? { id: row.issued_by, name: issuedBy.name } : null,
    issuedAt: row.issued_at ? toInstant(row.issued_at) : null,
  };
}

function iso(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

function isoDate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export async function issueInvoice(bookingId: string, member: SessionMember, now: Date): Promise<BookingRow> {
  return withTransaction(async (tx) => {
    const row = await tx.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    if (!row) throw errors.notFound();
    if (row.state === "invoiced") {
      const who = await tx.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.issued_by || row.confirmed_by]);
      throw errors.conflict("already_invoiced", { issuedBy: who?.name || "", issuedAt: toInstant(row.issued_at || row.confirmed_at) });
    }
    if (!row.killbill_invoice_id) throw errors.billingUnavailable();
    try {
      await commitInvoice(row.killbill_invoice_id);
    } catch (err) {
      if (err instanceof BillingOutage) throw errors.billingUnavailable();
      throw err;
    }
    await tx.query(`UPDATE bookings SET state = 'invoiced', issued_by = $2, issued_at = $3 WHERE id = $1`, [bookingId, member.id, now]);
    const fresh = await tx.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    if (!fresh) throw new Error("booking missing");
    return fresh;
  });
}
