// Kill Bill: one account per owner with an external payment method, invoices of external charges, external
// purchases against an invoice and refunds with an item adjustment, each carrying our external key so a retry
// can find and adopt what an earlier attempt left (brief: Services, Kill Bill). Every call has a 5 s timeout; a
// connect failure, timeout or 5xx raises BillingUnavailable (brief: Billing outage).
import { config } from "./config.js";
const TIMEOUT_MS = 5_000;
export class BillingUnavailable extends Error {
}
async function call(method, path, body) {
    const { url, username, password, apiKey, apiSecret } = config.killbill;
    let response;
    try {
        response = await fetch(`${url}/1.0/kb${path}`, {
            method,
            headers: {
                authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
                "x-killbill-apikey": apiKey,
                "x-killbill-apisecret": apiSecret,
                "x-killbill-createdby": "clinchline",
                accept: "application/json",
                ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    }
    catch (error) {
        throw new BillingUnavailable(`Kill Bill ${method} ${path.split("?")[0]} failed`, { cause: error });
    }
    if (response.status >= 500)
        throw new BillingUnavailable(`Kill Bill answered ${response.status}`);
    return response;
}
async function expectJson(response, ok) {
    if (!ok.includes(response.status)) {
        throw new BillingUnavailable(`Kill Bill answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json());
}
async function expectStatus(response, ok) {
    if (!ok.includes(response.status)) {
        throw new BillingUnavailable(`Kill Bill answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    await response.arrayBuffer();
}
/**
 * True when this instance can reach Kill Bill right now: an authenticated, read-only call answers without a 5xx.
 * Kill Bill's own /healthcheck also grades its internal queues, which can report unhealthy while the API serves.
 */
export async function billingReachable(timeoutMs = 2_000) {
    const { url, username, password } = config.killbill;
    try {
        const response = await fetch(`${url}/1.0/kb/security/subject`, {
            headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, accept: "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        await response.arrayBuffer();
        return response.status < 500;
    }
    catch {
        return false;
    }
}
const dollars = (cents) => cents / 100;
export const toCents = (amount) => Math.round(amount * 100);
/** The owner's account (external key = email) and its external payment method, created when missing. */
export async function ensureAccount(owner) {
    const created = await call("POST", "/accounts", { name: owner.name, email: owner.email, externalKey: owner.email, currency: "USD" });
    let accountId;
    if (created.status === 201) {
        accountId = created.headers.get("location")?.split("/").filter(Boolean).pop() ?? "";
        await created.arrayBuffer();
    }
    else {
        await created.arrayBuffer();
        accountId = (await expectJson(await call("GET", `/accounts?externalKey=${encodeURIComponent(owner.email)}`), [200]))
            .accountId;
    }
    const methods = await expectJson(await call("GET", `/accounts/${accountId}/paymentMethods`), [200]);
    const existing = methods.find((method) => method.pluginName === "__EXTERNAL_PAYMENT__");
    if (existing)
        return { accountId, paymentMethodId: existing.paymentMethodId };
    // Not the account default: a default method would make Kill Bill pay every new invoice by itself.
    const made = await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=false`, { pluginName: "__EXTERNAL_PAYMENT__" });
    if (made.status === 201) {
        const paymentMethodId = made.headers.get("location")?.split("/").filter(Boolean).pop() ?? "";
        await made.arrayBuffer();
        return { accountId, paymentMethodId };
    }
    await made.arrayBuffer();
    const again = await expectJson(await call("GET", `/accounts/${accountId}/paymentMethods`), [200]);
    const method = again.find((m) => m.pluginName === "__EXTERNAL_PAYMENT__");
    if (!method)
        throw new BillingUnavailable("Kill Bill has no external payment method for the account");
    return { accountId, paymentMethodId: method.paymentMethodId };
}
export const accountInvoices = async (accountId) => expectJson(await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`), [200]);
export const getInvoice = async (kbInvoiceId) => expectJson(await call("GET", `/invoices/${kbInvoiceId}`), [200]);
export const invoicePayments = async (kbInvoiceId) => expectJson(await call("GET", `/invoices/${kbInvoiceId}/payments`), [200]);
export const accountPayments = async (accountId) => expectJson(await call("GET", `/accounts/${accountId}/payments`), [200]);
/** The invoice whose items carry `[<marker>]`, or null. */
export function findInvoice(invoices, marker) {
    return invoices.find((invoice) => invoice.items.some((item) => item.description?.endsWith(`[${marker}]`))) ?? null;
}
/** The payment holding a transaction with this external key, or null. */
export function findPayment(payments, transactionKey) {
    return payments.find((payment) => payment.transactions.some((t) => t.transactionExternalKey === transactionKey)) ?? null;
}
/** One Kill Bill invoice of external charges; multiple charges in one call land on one invoice. */
export async function createCharges(accountId, charges) {
    const items = await expectJson(await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, charges.map((charge) => ({ accountId, description: charge.description, amount: dollars(charge.amount_cents), currency: "USD" }))), [200, 201]);
    const firstItem = items[0];
    if (!firstItem)
        throw new BillingUnavailable("Kill Bill created no invoice items");
    return getInvoice(firstItem.invoiceId);
}
/** An external purchase applied to a Kill Bill invoice, keyed by its payment and transaction external key. */
export async function purchaseOnInvoice(account, kbInvoiceId, amountCents, key) {
    const query = new URLSearchParams({
        paymentMethodId: account.paymentMethodId,
        controlPluginName: "__INVOICE_PAYMENT_CONTROL_PLUGIN__",
        pluginProperty: `IPCD_INVOICE_ID=${kbInvoiceId}`,
    });
    await expectStatus(await call("POST", `/accounts/${account.accountId}/payments?${query}`, {
        transactionType: "PURCHASE",
        amount: dollars(amountCents),
        currency: "USD",
        paymentExternalKey: key,
        transactionExternalKey: key,
    }), [200, 201]);
}
/** The sum of CREDIT transactions carrying one of these external keys, across the given payments. */
export function creditedCents(payments, keys) {
    return payments
        .flatMap((payment) => payment.transactions)
        .filter((t) => t.transactionType === "CREDIT" && t.status === "SUCCESS" && t.transactionExternalKey !== null && keys.has(t.transactionExternalKey))
        .reduce((sum, t) => sum + toCents(t.amount), 0);
}
/**
 * A refund on an invoice payment with `externalPayment=true` and an item adjustment for the refunded amount, so the
 * invoice's charges shrink by what was given back (brief: Services, Kill Bill). Kill Bill records an external refund
 * as a CREDIT transaction, keyed `key`, on a payment of its own and adds it to the invoice's `refundAdj`.
 */
export async function refundPayment(kbPaymentId, amountCents, key, invoice) {
    await expectStatus(await call("POST", `/invoicePayments/${kbPaymentId}/refunds?externalPayment=true`, {
        amount: dollars(amountCents),
        isAdjusted: true,
        adjustments: adjustments(invoice, amountCents),
        transactionExternalKey: key,
    }), [200, 201]);
}
/** Item adjustments adding up to the amount, taken from the charges that still have room, largest first. */
function adjustments(invoice, amountCents) {
    const adjusted = new Map();
    for (const item of invoice.items) {
        if (item.itemType === "ITEM_ADJ" && item.linkedInvoiceItemId) {
            adjusted.set(item.linkedInvoiceItemId, (adjusted.get(item.linkedInvoiceItemId) ?? 0) + toCents(item.amount));
        }
    }
    const room = invoice.items
        .filter((item) => item.itemType === "EXTERNAL_CHARGE")
        .map((item) => ({ item, left: toCents(item.amount) + (adjusted.get(item.invoiceItemId) ?? 0) }))
        .filter((entry) => entry.left > 0)
        .sort((a, b) => b.left - a.left);
    const out = [];
    let remaining = amountCents;
    for (const { item, left } of room) {
        if (remaining <= 0)
            break;
        const take = Math.min(left, remaining);
        out.push({ invoiceItemId: item.invoiceItemId, invoiceId: item.invoiceId, amount: dollars(take), currency: "USD" });
        remaining -= take;
    }
    return out;
}
