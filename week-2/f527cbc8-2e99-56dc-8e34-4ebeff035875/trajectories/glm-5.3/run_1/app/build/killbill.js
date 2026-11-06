import { config } from './config.js';
export class KillBillError extends Error {
    kind;
    constructor(kind) {
        super(kind);
        this.kind = kind;
    }
}
function headers() {
    return {
        'Authorization': 'Basic ' + Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64'),
        'X-Killbill-Apikey': config.killbillApiKey,
        'X-Killbill-ApiSecret': config.killbillApiSecret,
        'X-Killbill-CreatedBy': 'clinchline',
        'Content-Type': 'application/json'
    };
}
async function call(method, path, body) {
    const url = `${config.killbillUrl}/1.0/kb${path}`;
    try {
        const res = await fetch(url, {
            method,
            headers: headers(),
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(5000)
        });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch {
            json = null;
        }
        if (res.status >= 500)
            throw new KillBillError('server');
        return { status: res.status, json };
    }
    catch (e) {
        if (e instanceof KillBillError)
            throw e;
        throw new KillBillError('unreachable');
    }
}
const usd = (cents) => Math.round(cents) / 100;
export async function ensureAccount(ownerEmail, ownerName) {
    const found = await call('GET', `/accounts?externalKey=${encodeURIComponent(ownerEmail)}`);
    if (found.status === 200 && found.json && found.json.accountId)
        return found.json.accountId;
    const created = await call('POST', `/accounts?createdBy=clinchline`, {
        externalKey: ownerEmail, name: ownerName, currency: 'USD'
    });
    if (created.status === 201 && created.json && created.json.accountId)
        return created.json.accountId;
    const again = await call('GET', `/accounts?externalKey=${encodeURIComponent(ownerEmail)}`);
    if (again.status === 200 && again.json && again.json.accountId)
        return again.json.accountId;
    throw new KillBillError('server');
}
export async function getAccount(ownerEmail) {
    const found = await call('GET', `/accounts?externalKey=${encodeURIComponent(ownerEmail)}`);
    return found.status === 200 ? found.json : null;
}
export async function createInvoiceWithCharges(accountId, invoiceDate, charges) {
    const items = charges.map(c => ({
        itemType: 'EXTERNAL_CHARGE', description: c.description, amount: usd(c.amount_cents), currency: 'USD', startDate: invoiceDate
    }));
    const res = await call('POST', `/invoices/charges/${accountId}?autoCommit=true&targetDate=${invoiceDate}`, items);
    if ((res.status === 200 || res.status === 201) && Array.isArray(res.json) && res.json.length > 0) {
        return { invoiceId: res.json[0].invoiceId, created: true };
    }
    throw new KillBillError('server');
}
export async function findInvoiceIdByMarker(accountId, marker) {
    const res = await call('GET', `/accounts/${accountId}/invoices`);
    if (res.status !== 200 || !Array.isArray(res.json))
        return null;
    for (const inv of res.json) {
        for (const item of inv.items ?? []) {
            if (typeof item.description === 'string' && item.description.includes(marker))
                return inv.invoiceId;
        }
    }
    return null;
}
export async function getInvoiceBalance(invoiceId) {
    const res = await call('GET', `/invoices/${invoiceId}`);
    if (res.status !== 200 || !res.json)
        return null;
    const inv = res.json;
    const total = Math.round((inv.amount ?? 0) * 100);
    const pay = await call('GET', `/invoices/${invoiceId}/payments`);
    let paid = 0;
    let refunded = 0;
    if (pay.status === 200 && Array.isArray(pay.json)) {
        for (const p of pay.json) {
            paid += Math.round((p.purchasedAmount ?? 0) * 100);
            refunded += Math.round((p.refundedAmount ?? 0) * 100);
        }
    }
    return { balance: Math.round((inv.balance ?? 0) * 100), paid, refunded, total };
}
export async function getInvoiceReadback(accountId, invoiceId, creditPrefix) {
    const base = await getInvoiceBalance(invoiceId);
    if (!base)
        return null;
    const acctPay = await call('GET', `/accounts/${accountId}/payments`);
    let credited = 0;
    if (acctPay.status === 200 && Array.isArray(acctPay.json)) {
        for (const p of acctPay.json) {
            for (const t of p.transactions ?? []) {
                if (typeof t.transactionExternalKey === 'string' && t.transactionExternalKey.startsWith(creditPrefix)) {
                    credited += Math.round((p.creditedAmount ?? t.amount ?? 0) * 100);
                }
            }
        }
    }
    return { ...base, refunded: base.refunded + credited };
}
export async function createExternalPayment(invoiceId, accountId, amountCents, paymentExternalKey, transactionExternalKey) {
    const existing = await findPaymentIdByKey(invoiceId, paymentExternalKey);
    if (existing)
        return { paymentId: existing, created: false };
    const res = await call('POST', `/invoices/${invoiceId}/payments?externalPayment=true`, {
        accountId,
        targetInvoiceId: invoiceId,
        purchasedAmount: usd(amountCents),
        paymentExternalKey,
        transactions: [{ transactionType: 'PURCHASE', amount: usd(amountCents), currency: 'USD', transactionExternalKey }]
    });
    if (res.status === 200 || res.status === 201 || res.status === 204) {
        const found = await findPaymentIdByKey(invoiceId, paymentExternalKey);
        if (found)
            return { paymentId: found, created: true };
        if (res.json && res.json.paymentId)
            return { paymentId: res.json.paymentId, created: true };
    }
    throw new KillBillError('server');
}
export async function findPaymentIdByKey(invoiceId, paymentExternalKey) {
    const res = await call('GET', `/invoices/${invoiceId}/payments`);
    if (res.status !== 200 || !Array.isArray(res.json))
        return null;
    for (const p of res.json) {
        if (p.paymentExternalKey === paymentExternalKey)
            return p.paymentId;
    }
    return null;
}
export async function transferDepositCreditOut(accountId, invoiceId, depositInPaymentId, amountCents, transactionExternalKey) {
    const exists = await findCreditTransaction(accountId, transactionExternalKey);
    if (exists)
        return false;
    const items = await call('GET', `/invoices/${invoiceId}`);
    let adjustments = [];
    if ((items.status === 200 || items.status === 201) && Array.isArray(items.json?.items)) {
        const charge = items.json.items.find((i) => i.itemType === 'EXTERNAL_CHARGE');
        if (charge)
            adjustments = [{ invoiceItemId: charge.invoiceItemId, amount: usd(amountCents) }];
    }
    const res = await call('POST', `/invoicePayments/${depositInPaymentId}/refunds?externalPayment=true`, {
        transactionType: 'CREDIT', amount: usd(amountCents), currency: 'USD',
        isAdjusted: true, adjustments, transactionExternalKey
    });
    if (res.status === 200 || res.status === 201 || res.status === 204)
        return true;
    throw new KillBillError('server');
}
export async function createRefund(accountId, paymentId, invoiceId, amountCents, transactionExternalKey) {
    const existing = await findCreditTransaction(accountId, transactionExternalKey);
    if (existing)
        return { created: false };
    const items = await call('GET', `/invoices/${invoiceId}`);
    let adjustments = [];
    if ((items.status === 200 || items.status === 201) && Array.isArray(items.json?.items)) {
        const charge = items.json.items.find((i) => i.itemType === 'EXTERNAL_CHARGE');
        if (charge)
            adjustments = [{ invoiceItemId: charge.invoiceItemId, amount: usd(amountCents) }];
    }
    const res = await call('POST', `/invoicePayments/${paymentId}/refunds?externalPayment=true`, {
        transactionType: 'CREDIT', amount: usd(amountCents), currency: 'USD',
        isAdjusted: true, adjustments, transactionExternalKey
    });
    if (res.status === 200 || res.status === 201 || res.status === 204)
        return { created: true };
    throw new KillBillError('server');
}
export async function findPaymentIdByTransactionKey(invoiceId, transactionExternalKey) {
    const res = await call('GET', `/invoices/${invoiceId}/payments`);
    if (res.status !== 200 || !Array.isArray(res.json))
        return null;
    for (const p of res.json) {
        if (p.paymentExternalKey === transactionExternalKey)
            return p.paymentId;
        for (const t of p.transactions ?? []) {
            if (t.transactionExternalKey === transactionExternalKey)
                return p.paymentId;
        }
    }
    return null;
}
export async function findCreditTransaction(accountId, transactionExternalKey) {
    const res = await call('GET', `/accounts/${accountId}/payments`);
    if (res.status !== 200 || !Array.isArray(res.json))
        return false;
    for (const p of res.json) {
        for (const t of p.transactions ?? []) {
            if (t.transactionExternalKey === transactionExternalKey)
                return true;
        }
    }
    return false;
}
export async function killbillUp() {
    try {
        await fetch(`${config.killbillUrl}/1.0/kb/health`, {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64'),
                'X-Killbill-Apikey': config.killbillApiKey,
                'X-Killbill-ApiSecret': config.killbillApiSecret
            },
            signal: AbortSignal.timeout(2000)
        });
        return true;
    }
    catch {
        return false;
    }
}
