// Kill Bill: one account per grower (external key = grower id), deposit and balance invoices as external
// charges, the deposit credit, voids and the settlement payment. Unreachable → 503 billing_unavailable.

import { config } from "../config.js";
import { one, type Db } from "../db.js";
import { billingUnavailable } from "../http.js";

const AUTH = "Basic " + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");

/** Integer cents as an exact decimal literal for Kill Bill's JSON (no float ever carries money). */
function decimal(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

interface KbResponse {
  status: number;
  body: unknown;
}

async function call(method: string, path: string, body?: string): Promise<KbResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: AUTH,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "bloom-desk",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw billingUnavailable();
  }
  if (response.status >= 500) throw billingUnavailable();
  const raw = await response.text();
  if (response.status >= 400 && response.status !== 404 && response.status !== 409) {
    throw new Error(`Kill Bill ${method} ${path.split("?")[0]} answered ${response.status}`);
  }
  return { status: response.status, body: raw ? (JSON.parse(raw) as unknown) : null };
}

function field(value: unknown, name: string): string {
  const found = (value as Record<string, unknown> | null)?.[name];
  if (typeof found !== "string") throw new Error(`Kill Bill response is missing ${name}`);
  return found;
}

async function accountIdByKey(externalKey: string): Promise<string | null> {
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  return found.status === 404 ? null : field(found.body, "accountId");
}

/** The grower's Kill Bill account id, created on first use and remembered in PostgreSQL. */
export async function growerAccount(db: Db, growerId: string): Promise<string> {
  const grower = await one<{ name: string; email: string; kb_account_id: string | null }>(
    db,
    "SELECT name, email, kb_account_id FROM users WHERE id = $1",
    [growerId],
  );
  if (!grower) throw new Error(`unknown grower ${growerId}`);
  if (grower.kb_account_id) return grower.kb_account_id;
  let accountId = await accountIdByKey(growerId);
  if (accountId === null) {
    await call("POST", "/accounts", JSON.stringify({ name: grower.name, externalKey: growerId, currency: "USD", email: grower.email }));
    accountId = await accountIdByKey(growerId);
    if (accountId === null) throw new Error("Kill Bill account was not created");
  }
  await db.query("UPDATE users SET kb_account_id = $1 WHERE id = $2", [accountId, growerId]);
  return accountId;
}

interface Charge {
  cents: number;
  description: string;
}

/** One invoice holding one external charge per entry; returns the invoice id. */
export async function invoiceCharges(accountId: string, charges: readonly Charge[]): Promise<string> {
  const items = charges.map(
    (charge) => `{"accountId":${JSON.stringify(accountId)},"currency":"USD","amount":${decimal(charge.cents)},"description":${JSON.stringify(charge.description)}}`,
  );
  const created = await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, `[${items.join(",")}]`);
  const first = Array.isArray(created.body) ? (created.body[0] as unknown) : null;
  return field(first, "invoiceId");
}

/** One account credit; returns the invoice that carries it. */
export async function creditAccount(accountId: string, cents: number, description: string): Promise<string> {
  const created = await call(
    "POST",
    "/credits?autoCommit=true",
    `[{"accountId":${JSON.stringify(accountId)},"currency":"USD","amount":${decimal(cents)},"description":${JSON.stringify(description)}}]`,
  );
  const first = Array.isArray(created.body) ? (created.body[0] as unknown) : null;
  return field(first, "invoiceId");
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call("PUT", `/invoices/${invoiceId}/voidInvoice`);
}

export async function paymentByKey(externalKey: string): Promise<string | null> {
  const found = await call("GET", `/payments?externalKey=${encodeURIComponent(externalKey)}`);
  return found.status === 404 ? null : field(found.body, "paymentId");
}

/** One external payment against an unpaid invoice, carrying the external key. */
export async function payInvoice(accountId: string, invoiceId: string, cents: number, externalKey: string): Promise<string> {
  await call(
    "POST",
    `/invoices/${invoiceId}/payments?externalPayment=true`,
    `{"accountId":${JSON.stringify(accountId)},"targetInvoiceId":${JSON.stringify(invoiceId)},"purchasedAmount":${decimal(cents)},"paymentExternalKey":${JSON.stringify(externalKey)}}`,
  );
  const paymentId = await paymentByKey(externalKey);
  if (paymentId === null) throw new Error("Kill Bill payment was not recorded");
  return paymentId;
}
