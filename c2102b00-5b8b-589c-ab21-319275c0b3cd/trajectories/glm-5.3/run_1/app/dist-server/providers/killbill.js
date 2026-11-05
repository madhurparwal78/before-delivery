"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KbUnreachable = exports.KbTimeout = void 0;
exports.findAccount = findAccount;
exports.createAccount = createAccount;
exports.ensurePaymentMethod = ensurePaymentMethod;
exports.findPaymentByExternalKey = findPaymentByExternalKey;
exports.createPurchase = createPurchase;
exports.listInvoices = listInvoices;
exports.postCharges = postCharges;
exports.paymentsStatus = paymentsStatus;
const db_1 = require("../db");
const config_1 = require("../config");
class KbTimeout extends Error {
    constructor() {
        super("Kill Bill did not answer in time");
    }
}
exports.KbTimeout = KbTimeout;
class KbUnreachable extends Error {
    cause;
    constructor(cause) {
        super(`Kill Bill is unreachable: ${cause}`);
        this.cause = cause;
    }
}
exports.KbUnreachable = KbUnreachable;
function kbFetch(path, init, timeoutMs = config_1.PRODUCER_TIMEOUT_MS) {
    const url = `${db_1.config.killbillUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
        "X-Killbill-ApiKey": db_1.config.killbillApiKey,
        "X-Killbill-ApiSecret": db_1.config.killbillApiSecret,
        "X-Killbill-CreatedBy": "tare-and-tally",
        ...init.headers,
    };
    return fetch(url, { ...init, headers, signal: controller.signal })
        .then(async (res) => {
        const text = await res.text();
        let body = null;
        if (text.length > 0) {
            try {
                body = JSON.parse(text);
            }
            catch {
                body = text;
            }
        }
        const outHeaders = {};
        res.headers.forEach((v, k) => {
            outHeaders[k.toLowerCase()] = v;
        });
        return { status: res.status, body, headers: outHeaders };
    })
        .finally(() => clearTimeout(timer))
        .catch((e) => {
        if (e instanceof Error && e.name === "AbortError")
            throw new KbTimeout();
        throw new KbUnreachable(e instanceof Error ? e.message : String(e));
    });
}
function authHeader() {
    return { Authorization: `Basic ${Buffer.from(`${db_1.config.killbillUsername}:${db_1.config.killbillPassword}`).toString("base64")}` };
}
/** Finds the household's account by external key, or null when Kill Bill has none. */
async function findAccount(externalKey) {
    const res = await kbFetch(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, {
        method: "GET",
        headers: authHeader(),
    });
    if (res.status === 404)
        return null;
    if (res.status !== 200)
        throw new Error(`Kill Bill account lookup failed: ${res.status}`);
    const body = res.body;
    if (typeof body?.accountId === "string")
        return body.accountId;
    return null;
}
async function createAccount(externalKey, name, email) {
    const res = await kbFetch(`/1.0/kb/accounts`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ externalKey, name, email, currency: "USD" }),
    });
    if (res.status !== 201 || !res.headers.location)
        throw new Error(`Kill Bill account creation failed: ${res.status}`);
    const accountId = res.headers.location.split("/").pop();
    if (!accountId)
        throw new Error("Kill Bill account id missing");
    return accountId;
}
async function ensurePaymentMethod(accountId) {
    const create = await kbFetch(`/1.0/kb/accounts/${accountId}/paymentMethods`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", isDefault: true, pluginInfo: {} }),
    });
    if (create.status !== 201 || !create.headers.location) {
        if (create.status === 400) {
            // An external payment method already exists on this account.
            const body = create.body;
            if (typeof body?.message === "string" && body.message.includes("already exists"))
                return;
        }
        throw new Error(`Kill Bill payment method failed: ${create.status}`);
    }
    const methodId = create.headers.location.split("/").pop();
    const setDefault = await kbFetch(`/1.0/kb/accounts/${accountId}/paymentMethods/${methodId}/setDefault?payAllUnpaidInvoices=false`, { method: "PUT", headers: authHeader() });
    if (setDefault.status !== 204)
        throw new Error(`Kill Bill set default method failed: ${setDefault.status}`);
}
/** The payment with this external key, or null. */
async function findPaymentByExternalKey(paymentExternalKey) {
    const res = await kbFetch(`/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`, {
        method: "GET",
        headers: authHeader(),
    });
    if (res.status === 404)
        return null;
    if (res.status !== 200)
        throw new Error(`Kill Bill payment lookup failed: ${res.status}`);
    return res.body;
}
async function createPurchase(accountId, dollars, paymentExternalKey) {
    const body = {
        transactionType: "PURCHASE",
        amount: JSON.parse(dollars),
        currency: "USD",
        paymentExternalKey,
        transactionExternalKey: paymentExternalKey,
    };
    const res = await kbFetch(`/1.0/kb/accounts/${accountId}/payments`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (res.status !== 201)
        throw new Error(`Kill Bill purchase failed: ${res.status}`);
}
async function listInvoices(accountId) {
    const res = await kbFetch(`/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`, { method: "GET", headers: authHeader() });
    if (res.status !== 200)
        throw new Error(`Kill Bill invoice listing failed: ${res.status}`);
    return res.body;
}
/** Posts all charges on one committed invoice. */
async function postCharges(accountId, charges) {
    const body = charges.map((c) => ({ amount: JSON.parse(c.amount), description: c.description }));
    const res = await kbFetch(`/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (res.status !== 200)
        throw new Error(`Kill Bill charge post failed: ${res.status}`);
}
let statusCache = { state: "available", checkedAt: 0 };
async function paymentsStatus() {
    const now = Date.now();
    if (now - statusCache.checkedAt <= 2000)
        return statusCache.state;
    try {
        await kbFetch(`/1.0/kb/accounts?externalKey=${encodeURIComponent("tally-status-probe")}`, {
            method: "GET",
            headers: authHeader(),
        }, 2500);
        statusCache = { state: "available", checkedAt: now };
    }
    catch {
        statusCache = { state: "paused", checkedAt: now };
    }
    return statusCache.state;
}
