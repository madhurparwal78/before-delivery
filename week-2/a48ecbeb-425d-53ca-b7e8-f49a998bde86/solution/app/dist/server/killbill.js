import { config } from "./config.js";
import { billingUnavailable } from "./http.js";
// Kill Bill, the record of all money. Every call names the tenant from the environment.
const BASE = `${config.killbill.url}/1.0/kb`;
const AUTH = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;
const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
const AUTO_INVOICING_DRAFT = "00000000-0000-0000-0000-000000000008";
export class KillBillError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`Kill Bill answered ${status}`);
        this.status = status;
        this.body = body;
    }
}
async function call(method, path, options = {}) {
    const url = new URL(BASE + path);
    for (const [key, value] of Object.entries(options.query ?? {}))
        url.searchParams.set(key, value);
    const headers = {
        Authorization: AUTH,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "ceibo-shop",
        Accept: "application/json",
    };
    let body;
    if (options.xml !== undefined) {
        headers["Content-Type"] = "text/xml";
        body = options.xml;
    }
    else if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.body);
    }
    let response;
    try {
        response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20_000) });
    }
    catch {
        throw billingUnavailable();
    }
    const text = await response.text();
    if (response.status >= 500)
        throw billingUnavailable();
    return { status: response.status, location: response.headers.get("location"), text };
}
async function json(method, path, options = {}) {
    const answer = await call(method, path, options);
    if (answer.status >= 300)
        throw new KillBillError(answer.status, answer.text);
    return JSON.parse(answer.text);
}
async function write(method, path, options = {}) {
    const answer = await call(method, path, options);
    if (answer.status >= 300)
        throw new KillBillError(answer.status, answer.text);
    return answer;
}
const idFrom = (location) => (location ?? "").split("/").pop()?.split("?")[0] ?? "";
/** Reachability, read from the tenant clock: `/1.0/healthcheck` also fails while Kill Bill's
 *  queues lag, which leaves billing working and is no outage. */
export async function probeKillBill() {
    try {
        const response = await fetch(`${BASE}/test/clock`, {
            headers: {
                Authorization: AUTH,
                "X-Killbill-ApiKey": config.killbill.apiKey,
                "X-Killbill-ApiSecret": config.killbill.apiSecret,
            },
            signal: AbortSignal.timeout(2500),
        });
        return response.status === 200;
    }
    catch {
        return false;
    }
}
const REGULAR = ["guava-lime", "yuzu-ginger", "passionfruit-basil"];
const BOX_LABELS = {
    "guava-lime": "Guava & Lime box",
    "yuzu-ginger": "Yuzu Ginger box",
    "passionfruit-basil": "Passionfruit Basil box",
    discovery: "Discovery box",
};
const RECURRING_PRICE = "35.96";
const PLANS = [...REGULAR, "discovery"].flatMap((box) => ["monthly", "bimonthly"].map((cadence) => ({
    name: `ceibo-${box}-${cadence}`,
    label: BOX_LABELS[box],
    cadence,
    box: box === "discovery" ? REGULAR.map((f) => ({ flavour: f, quantity: 4 })) : [{ flavour: box, quantity: 12 }],
})));
export const planByName = (name) => PLANS.find((p) => p.name === name);
/** The plan for an eligible crate: 12 of one regular flavour, or 4 of each regular flavour. */
export function planForCrate(counts, cadence) {
    const entries = [...counts.entries()].filter(([, n]) => n > 0);
    const total = entries.reduce((a, [, n]) => a + n, 0);
    if (total !== 12 || entries.some(([f]) => !REGULAR.includes(f)))
        return undefined;
    if (entries.length === 1)
        return planByName(`ceibo-${entries[0][0]}-${cadence}`);
    if (entries.length === 3 && entries.every(([, n]) => n === 4))
        return planByName(`ceibo-discovery-${cadence}`);
    return undefined;
}
// Processes sharing the tenant may upload at the same moment. Kill Bill refuses to load a catalogue
// with two versions on one effective date, so each upload takes its own second within 2020.
const catalogEffectiveDate = () => new Date(Date.UTC(2020, 0, 1) + Math.floor(Math.random() * 365 * 86_400) * 1000).toISOString().replace(".000Z", "+00:00");
function catalogXml() {
    const plan = (p) => `
    <plan name="${p.name}" prettyName="${p.label.replace(/&/g, "&amp;")}">
      <product>ceibo-box</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>${p.cadence === "monthly" ? "MONTHLY" : "BIMESTRIAL"}</billingPeriod>
          <recurringPrice><price><currency>CAD</currency><value>${RECURRING_PRICE}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${catalogEffectiveDate()}</effectiveDate>
  <catalogName>ceibo</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>CAD</currency></currencies>
  <products><product name="ceibo-box" prettyName="Ceibo box"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>${PLANS.map(plan).join("")}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans>${PLANS.map((p) => `<plan>${p.name}</plan>`).join("")}</plans></defaultPriceList>
  </priceLists>
</catalog>`;
}
/** Uploads the catalogue only when the tenant lacks any of the eight plans. */
export async function ensureCatalog() {
    const answer = await call("GET", "/catalog");
    const text = answer.status === 200 ? answer.text : "";
    if (PLANS.every((p) => text.includes(`"${p.name}"`)))
        return;
    const upload = await call("POST", "/catalog/xml", { xml: catalogXml() });
    if (upload.status >= 300) {
        const again = await call("GET", "/catalog");
        if (!PLANS.every((p) => again.text.includes(`"${p.name}"`)))
            throw new KillBillError(upload.status, upload.text);
    }
}
// ---- clock --------------------------------------------------------------------------------
/** Kill Bill's current time (the tenant's test clock). */
export async function killBillNow() {
    const clock = await json("GET", "/test/clock");
    return new Date(clock.currentUtcTime);
}
/** One account per customer, looked up by external key (the PocketBase user id) before creating. */
export async function ensureAccount(userId, email, name) {
    const found = await call("GET", "/accounts", { query: { externalKey: userId } });
    if (found.status === 200)
        return JSON.parse(found.text).accountId;
    const created = await call("POST", "/accounts", {
        body: { name, email, externalKey: userId, currency: "CAD", timeZone: "UTC" },
    });
    let accountId;
    if (created.status === 201) {
        accountId = idFrom(created.location);
    }
    else {
        accountId = (await json("GET", "/accounts", { query: { externalKey: userId } })).accountId;
    }
    await write("POST", `/accounts/${accountId}/tags`, { body: [AUTO_PAY_OFF, AUTO_INVOICING_DRAFT] }).catch((error) => {
        if (!(error instanceof KillBillError && error.status === 409))
            throw error;
    });
    return accountId;
}
export async function accountBalanceCents(accountId) {
    const account = await json("GET", `/accounts/${accountId}`, { query: { accountWithBalance: "true" } });
    return toCents(account.accountBalance ?? 0);
}
/** The account's payment method; Kill Bill keeps one external method per account, made on first use. */
export async function paymentMethodFor(accountId) {
    const methods = await json("GET", `/accounts/${accountId}/paymentMethods`);
    const existing = methods.find((m) => m.pluginName === "__EXTERNAL_PAYMENT__");
    if (existing)
        return existing.paymentMethodId;
    const answer = await call("POST", `/accounts/${accountId}/paymentMethods`, {
        query: { isDefault: "true" },
        body: { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} },
    });
    if (answer.status === 201)
        return idFrom(answer.location);
    const again = await json("GET", `/accounts/${accountId}/paymentMethods`);
    const made = again.find((m) => m.pluginName === "__EXTERNAL_PAYMENT__");
    if (!made)
        throw new KillBillError(answer.status, answer.text);
    return made.paymentMethodId;
}
// ---- money --------------------------------------------------------------------------------
/** Kill Bill speaks decimal dollars; the app speaks integer cents. Parsed from the decimal text. */
function toCents(amount) {
    const text = String(amount);
    const match = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text);
    if (!match)
        throw new Error(`unexpected amount ${text}`);
    const cents = Number(match[2]) * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
    return match[1] === "-" ? -cents : cents;
}
function toDecimal(cents) {
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
async function paymentByKey(key) {
    const answer = await call("GET", "/payments", { query: { externalKey: key } });
    if (answer.status === 404)
        return undefined;
    if (answer.status >= 300)
        throw new KillBillError(answer.status, answer.text);
    return JSON.parse(answer.text);
}
export async function payment(paymentId) {
    return json("GET", `/payments/${paymentId}`);
}
/** One PURCHASE for a one-off order, keyed by the order's payment key. */
export async function purchase(accountId, paymentMethodId, cents, key) {
    const existing = await paymentByKey(key);
    if (existing)
        return existing.paymentId;
    await write("POST", `/accounts/${accountId}/payments`, {
        query: { paymentMethodId },
        body: { transactionType: "PURCHASE", amount: toDecimal(cents), currency: "CAD", paymentExternalKey: key },
    });
    const made = await paymentByKey(key);
    if (!made)
        throw new KillBillError(404, "payment missing after purchase");
    return made.paymentId;
}
export async function refundPayment(paymentId, cents, transactionKey) {
    await write("POST", `/payments/${paymentId}/refunds`, {
        body: { amount: toDecimal(cents), currency: "CAD", transactionExternalKey: transactionKey },
    });
}
export async function accountInvoices(accountId) {
    return json("GET", `/accounts/${accountId}/invoices`);
}
export async function invoice(invoiceId) {
    return json("GET", `/invoices/${invoiceId}`, { query: { withItems: "true" } });
}
/** Adds the box's deposit, shipping and tax lines to a draft invoice and commits it. */
export async function completeBoxInvoice(accountId, invoiceId, charges) {
    const current = await invoice(invoiceId);
    if (current.status === "DRAFT") {
        const items = charges
            .filter((c) => c.cents > 0)
            .map((c) => ({
            accountId,
            invoiceId,
            description: c.description,
            amount: toDecimal(c.cents),
            currency: "CAD",
            itemType: "EXTERNAL_CHARGE",
        }));
        if (items.length > 0)
            await write("POST", `/invoices/charges/${accountId}`, { query: { autoCommit: "false" }, body: items });
        await write("PUT", `/invoices/${invoiceId}/commitInvoice`);
    }
}
/** One payment for the whole invoice, keyed by the order's payment key. */
export async function payInvoice(accountId, invoiceId, paymentMethodId, cents, key) {
    const existing = await paymentByKey(key);
    if (existing)
        return existing.paymentId;
    await write("POST", `/invoices/${invoiceId}/payments`, {
        query: { externalPayment: "false" },
        body: { accountId, purchasedAmount: toDecimal(cents), paymentMethodId, paymentExternalKey: key },
    });
    const made = await paymentByKey(key);
    if (!made)
        throw new KillBillError(404, "payment missing after invoice payment");
    return made.paymentId;
}
export async function createSubscription(accountId, planName) {
    const answer = await write("POST", "/subscriptions", {
        query: { callCompletion: "true", callTimeoutSec: "10" },
        body: { accountId, planName },
    });
    return idFrom(answer.location);
}
export async function subscription(subscriptionId) {
    return json("GET", `/subscriptions/${subscriptionId}`);
}
export async function blockingStates(accountId, kind) {
    return json("GET", `/accounts/${accountId}/block`, { query: { blockingStateTypes: kind } });
}
/** A subscription blocking state of service `ceibo`; blocking states block billing and entitlement. */
export async function blockSubscription(subscriptionId, stateName, date) {
    const blocking = stateName !== "CEIBO_ACTIVE";
    await write("POST", `/subscriptions/${subscriptionId}/block`, {
        query: date === null ? {} : { requestedDate: date },
        body: { stateName, service: "ceibo", isBlockChange: false, isBlockEntitlement: blocking, isBlockBilling: blocking },
    });
}
export async function blockAccount(accountId, stateName) {
    await write("POST", `/accounts/${accountId}/block`, {
        body: { stateName, service: "ceibo-dunning", isBlockChange: false, isBlockEntitlement: false, isBlockBilling: false },
    });
}
export async function changePlan(subscriptionId, planName, date) {
    await write("PUT", `/subscriptions/${subscriptionId}`, {
        query: { requestedDate: date, callCompletion: "true", callTimeoutSec: "10" },
        body: { planName },
    });
}
export async function cancelAtEndOfTerm(subscriptionId) {
    await write("DELETE", `/subscriptions/${subscriptionId}`, {
        query: { entitlementPolicy: "END_OF_TERM", billingPolicy: "END_OF_TERM", callCompletion: "true", callTimeoutSec: "10" },
    });
}
export async function cancelNow(subscriptionId) {
    await write("DELETE", `/subscriptions/${subscriptionId}`, {
        query: { entitlementPolicy: "IMMEDIATE", billingPolicy: "IMMEDIATE", callCompletion: "true", callTimeoutSec: "10" },
    });
}
