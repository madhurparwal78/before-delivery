// Writing invoices: one item per ticked work code at the price in force on the business date, the stored trip
// share, and the deposit credit capped at the gross (brief: Business rules, Prices and invoices; Deposits).
import { randomUUID } from "node:crypto";
import { audit } from "./audit.js";
import { now } from "./clock.js";
import { SERVICE_NAMES, priceListOn } from "./domain/prices.js";
/** The visit invoice's items and its deposit credit: the smaller of the deposit left and the gross. */
export async function visitItems(client, input) {
    const { prices } = await priceListOn(client, input.businessDate);
    const items = input.work.map((code) => ({ description: `${SERVICE_NAMES[code]} — ${input.horse}`, amount_cents: prices[code] }));
    if (input.shareCents > 0)
        items.push({ description: `Trip share — ${input.barn} ${input.businessDate}`, amount_cents: input.shareCents });
    const gross = items.reduce((sum, item) => sum + item.amount_cents, 0);
    const creditCents = Math.min(input.depositLeftCents, gross);
    if (creditCents > 0)
        items.push({ description: `Deposit credit — ${input.horse} ${input.businessDate}`, amount_cents: -creditCents });
    return { items, creditCents };
}
/** Writes a pending invoice; `total_cents` sums every item including the credit and the balance starts there. */
export async function insertInvoice(client, invoice) {
    const id = randomUUID();
    const gross = invoice.items.filter((item) => item.amount_cents > 0).reduce((sum, item) => sum + item.amount_cents, 0);
    const total = invoice.items.reduce((sum, item) => sum + item.amount_cents, 0);
    await client.query(`INSERT INTO invoices (id, kind, status, horse_id, owner_id, visit_id, booking_id, barn_day_id, business_date, items, gross_cents,
                           credit_cents, total_cents, balance_cents, deposit_payment_id, next_attempt_at, created_at)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14, $15)`, [
        id,
        invoice.kind,
        invoice.horseId,
        invoice.ownerId,
        invoice.visitId,
        invoice.bookingId,
        invoice.barnDayId,
        invoice.businessDate,
        JSON.stringify(invoice.items),
        gross,
        invoice.creditCents,
        total,
        invoice.depositPaymentId,
        invoice.nextAttemptAt,
        new Date(now()),
    ]);
    await audit(client, { action: "create", entityType: "invoice", entityId: id, from: null, to: "pending" });
    return id;
}
