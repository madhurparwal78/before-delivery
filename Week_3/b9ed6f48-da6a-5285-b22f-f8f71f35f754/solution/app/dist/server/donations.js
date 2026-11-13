// Donations in exact minor units (brief: API › Commerce, Business rules › Money).
import { pool, tx } from "./db.js";
import { fail } from "./http.js";
import { assertBillingReachable, chargeInvoice, payInvoice } from "./killbill.js";
import { assertStorageReachable } from "./storage.js";
import { DONATION_LIMITS } from "./catalog.js";
import { deliverNow } from "./mail.js";
import { accountCurrency, chargeApproved, currencyLocked, declined, ensureAccount, newOrderId, nextReceiptNumber, orderById, orderJson, outcomeClass, recordOrder, settledAt, storeReceipt, } from "./payments.js";
import { COPY, copyFor } from "../shared/copy.js";
import { isCurrency, minorToMajor } from "../shared/money.js";
import { cardDigits } from "../shared/cards.js";
export async function donate(payer, input) {
    const locked = await accountCurrency(payer.id);
    if (locked && isCurrency(input.currency) && input.currency !== locked)
        throw currencyLocked(locked);
    const fields = {};
    const currency = isCurrency(input.currency) ? input.currency : null;
    const amount = input.amount_minor;
    if (!currency)
        fields.currency = "Choose EUR, GBP, USD or JPY.";
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < DONATION_LIMITS.min || amount > DONATION_LIMITS.max) {
        fields.amount_minor = copyFor.donationBounds(DONATION_LIMITS.min, DONATION_LIMITS.max, currency ?? "EUR");
    }
    const digits = typeof input.card_number === "string" ? cardDigits(input.card_number) : null;
    if (!digits)
        fields.card_number = COPY.cardField;
    const note = input.note ?? "";
    if (typeof note !== "string" || note.length > 500)
        fields.note = "Keep the note to 500 characters or fewer.";
    if (Object.keys(fields).length)
        throw fail.validation(fields);
    await assertStorageReachable().catch(() => {
        throw fail.storage(COPY.storagePurchase);
    });
    await assertBillingReachable().catch(() => {
        throw fail.billing();
    });
    const amountMinor = amount;
    const chosen = currency;
    const accountId = await ensureAccount(payer, chosen);
    if (!(await chargeApproved(payer.id, outcomeClass(digits))))
        throw declined();
    const orderId = newOrderId();
    const invoiceId = await chargeInvoice(accountId, minorToMajor(amountMinor, chosen), chosen, "Donation");
    const payment = await payInvoice(accountId, invoiceId, minorToMajor(amountMinor, chosen), `pay-${orderId}`);
    const settlement = {
        orderId,
        receiptNumber: await nextReceiptNumber(),
        payer,
        kind: "donation",
        description: "Donation",
        currency: chosen,
        amountMinor,
        last4: digits.slice(-4),
        invoiceId,
        payment,
        settledAt: settledAt(payment, amountMinor, chosen),
    };
    await storeReceipt(settlement);
    const mailId = await tx((db) => recordOrder(db, settlement, ""));
    const order = (await orderById(pool, orderId));
    return { status: 201, body: { order: orderJson(order), receipt_email: await deliverNow([mailId]) } };
}
