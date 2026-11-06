export async function ledgerEntry(tx, kind, amountCents, at, ownerId, horseId, businessDate, invoiceId, paymentId) {
    await tx.query(`insert into ledger(kind, amount_cents, at, owner_id, horse_id, business_date, invoice_id, payment_id)
     values($1,$2,$3,$4,$5,$6,$7,$8)`, [kind, amountCents, at, ownerId, horseId, businessDate, invoiceId, paymentId]);
}
