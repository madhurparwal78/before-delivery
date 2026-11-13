// Kill Bill REST client (brief: Services › Kill Bill). Amounts cross this boundary as
// major-unit decimal strings built from minor units, and come back through `majorToMinor`.
import { config } from "./config.js";
export class BillingUnreachable extends Error {
}
const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
async function call(method, path, body, contentType = "application/json") {
    const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
    let response;
    try {
        response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
            method,
            headers: {
                Authorization: `Basic ${auth}`,
                "X-Killbill-ApiKey": config.killbill.apiKey,
                "X-Killbill-ApiSecret": config.killbill.apiSecret,
                "X-Killbill-CreatedBy": "halden-sightline",
                Accept: "application/json",
                ...(body === undefined ? {} : { "Content-Type": contentType }),
            },
            body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
        });
    }
    catch {
        throw new BillingUnreachable();
    }
    const text = await response.text();
    let data = text;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        // XML or plain-text bodies stay as text
    }
    return { status: response.status, data, location: response.headers.get("location") };
}
async function ok(method, path, body, contentType) {
    const result = await call(method, path, body, contentType);
    if (result.status >= 300)
        throw new Error(`Kill Bill ${method} ${path} returned ${result.status}: ${JSON.stringify(result.data).slice(0, 400)}`);
    return result;
}
export async function assertBillingReachable() {
    const result = await call("GET", "/tenants/userKeyValue/halden-probe");
    if (result.status >= 500)
        throw new BillingUnreachable();
}
const idFrom = (location) => (location ?? "").split("/").filter(Boolean).pop()?.split("?")[0] ?? "";
export async function getCatalog() {
    const result = await ok("GET", "/catalog");
    return result.data ?? [];
}
export async function uploadCatalogVersion(xml) {
    await ok("POST", "/catalog/xml", xml, "text/xml");
}
export async function deleteCatalog() {
    await ok("DELETE", "/catalog");
}
// Accounts
export async function findAccount(externalKey) {
    const result = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (result.status === 404)
        return null;
    if (result.status >= 300)
        throw new Error(`Kill Bill account lookup returned ${result.status}`);
    return result.data;
}
/** Creates the account with AUTO_PAY_OFF and an external payment method as default. */
export async function createAccount(externalKey, name, email, currency) {
    const created = await call("POST", "/accounts", { externalKey, name, email, currency });
    const accountId = created.status === 201 ? idFrom(created.location) : (await findAccount(externalKey))?.accountId;
    if (!accountId)
        throw new Error(`Kill Bill account create returned ${created.status}`);
    await ok("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF]).catch(async (error) => {
        const tags = await ok("GET", `/accounts/${accountId}/tags`);
        if (!tags.data.some((t) => t.tagDefinitionId === AUTO_PAY_OFF))
            throw error;
    });
    const methods = await ok("GET", `/accounts/${accountId}/paymentMethods`);
    if (!methods.data.length) {
        await ok("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__" });
    }
    return accountId;
}
/** One invoice holding one external charge for the full amount. */
export async function chargeInvoice(accountId, amountMajor, currency, description) {
    const result = await ok("POST", `/invoices/charges/${accountId}?autoCommit=true`, [{ accountId, amount: amountMajor, currency, description }]);
    return result.data[0].invoiceId;
}
export async function accountInvoices(accountId) {
    return (await ok("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`)).data;
}
/** Pays the invoice in full with the account's external payment method; `paymentKey` makes it idempotent in Kill Bill. */
export async function payInvoice(accountId, invoiceId, amountMajor, paymentKey) {
    const existing = await call("GET", `/payments?externalKey=${encodeURIComponent(paymentKey)}`);
    if (existing.status === 200)
        return existing.data;
    const created = await ok("POST", `/invoices/${invoiceId}/payments?externalPayment=true`, {
        accountId,
        targetInvoiceId: invoiceId,
        purchasedAmount: amountMajor,
        paymentExternalKey: paymentKey,
    });
    const paymentId = idFrom(created.location);
    return (await ok("GET", `/payments/${paymentId}`)).data;
}
export function successfulPurchase(payment) {
    return payment.transactions.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
}
/** A refund transaction on the original payment; `refundKey` makes it idempotent in Kill Bill. */
export async function refundPayment(paymentId, amountMajor, currency, refundKey) {
    const payment = (await ok("GET", `/payments/${paymentId}`)).data;
    const done = payment.transactions.find((t) => t.transactionExternalKey === refundKey && t.status === "SUCCESS");
    if (done)
        return done;
    await ok("POST", `/payments/${paymentId}/refunds`, { amount: amountMajor, currency, transactionExternalKey: refundKey });
    const after = (await ok("GET", `/payments/${paymentId}`)).data;
    const refund = after.transactions.find((t) => t.transactionExternalKey === refundKey);
    if (!refund || refund.status !== "SUCCESS")
        throw new Error(`Kill Bill refund ${refundKey} did not succeed`);
    return refund;
}
/** Every payment of the tenant, page by page. */
export async function allPayments() {
    const payments = [];
    for (let offset = 0;; offset += 500) {
        const page = (await ok("GET", `/payments/pagination?offset=${offset}&limit=500&withPluginInfo=false`)).data;
        payments.push(...page);
        if (page.length < 500)
            return payments;
    }
}
export async function accountSubscriptions(accountId) {
    const bundles = (await ok("GET", `/accounts/${accountId}/bundles`)).data;
    return bundles.flatMap((b) => b.subscriptions);
}
export async function createSubscription(accountId, planName) {
    const created = await ok("POST", "/subscriptions?callCompletion=true&callTimeoutSec=30", { accountId, planName });
    return idFrom(created.location);
}
/** A plan change under the catalog's change rules (upgrades at once, downgrades at end of term). */
export async function changePlan(subscriptionId, planName) {
    await ok("PUT", `/subscriptions/${subscriptionId}?callCompletion=true&callTimeoutSec=30`, { planName });
}
export async function undoChangePlan(subscriptionId) {
    await ok("PUT", `/subscriptions/${subscriptionId}/undoChangePlan`, {});
}
/** Cancellation at the end of the paid term, for entitlement and billing alike. */
export async function cancelAtEndOfTerm(subscriptionId) {
    await ok("DELETE", `/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM`);
}
/** Cancellation now, used for a declined join, an overdue cancellation and the dunning end. */
export async function cancelImmediately(subscriptionId) {
    await ok("DELETE", `/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE&useRequestedDateForBilling=true`);
}
export async function uncancel(subscriptionId) {
    await ok("PUT", `/subscriptions/${subscriptionId}/uncancel`, {});
}
