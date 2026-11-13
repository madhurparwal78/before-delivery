// Kill Bill: one account per maker (externalKey = email), deposits and sales as PURCHASE payments,
// cancels as REFUND. App state follows only the transaction status Kill Bill returns.
import { config, SERVICE_TIMEOUT_MS } from "./config";
import { withClient } from "./db";
import { isObject } from "./http";
import { markService, Unreachable } from "./services";

const { killbill } = config;
const AUTH = `Basic ${Buffer.from(`${killbill.username}:${killbill.password}`).toString("base64")}`;

interface KbResponse {
  status: number;
  location: string | null;
  json: unknown;
}

async function call(method: string, pathAndQuery: string, body?: string): Promise<KbResponse> {
  try {
    const response = await fetch(`${killbill.url}${pathAndQuery}`, {
      method,
      headers: {
        Authorization: AUTH,
        "X-Killbill-ApiKey": killbill.apiKey,
        "X-Killbill-ApiSecret": killbill.apiSecret,
        "X-Killbill-CreatedBy": "kerfwell-rack",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    markService("billing", true);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, location: response.headers.get("location"), json };
  } catch (error) {
    throw new Unreachable("billing", error);
  }
}

export async function probeBilling(): Promise<void> {
  await call("GET", "/1.0/healthcheck");
}

/** Dollars with two decimals written straight from integer cents, so no float touches money. */
const dollars = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function accountByKey(email: string): Promise<{ id: string; paymentMethodId: string | null } | null> {
  const r = await call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(email)}`);
  if (r.status !== 200 || !isObject(r.json)) return null;
  const id = str(r.json["accountId"]);
  return id === null ? null : { id, paymentMethodId: str(r.json["paymentMethodId"]) };
}

const ACCOUNT_LOCK = 7_331_002;

export class PaymentFailed extends Error {}

/**
 * Finds or creates the maker's single account. Creation is serialised per maker across instances,
 * and a create refused because the key exists falls back to reading the account by key.
 */
export async function ensureAccount(makerId: number, name: string, email: string): Promise<string> {
  return withClient(async (client) => {
    await client.query("SELECT pg_advisory_lock($1, $2)", [ACCOUNT_LOCK, makerId]);
    try {
      let account = await accountByKey(email);
      if (account === null) {
        await call("POST", "/1.0/kb/accounts", JSON.stringify({ name, email, externalKey: email, currency: "USD" }));
        account = await accountByKey(email);
      }
      if (account === null) throw new PaymentFailed("account could not be created");
      if (account.paymentMethodId === null) {
        const pm = await call("POST", `/1.0/kb/accounts/${account.id}/paymentMethods?isDefault=true`,
          JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} }));
        if (pm.status >= 300) throw new PaymentFailed(`payment method refused: ${pm.status}`);
      }
      return account.id;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [ACCOUNT_LOCK, makerId]);
    }
  });
}

interface PaymentOutcome {
  paymentId: string | null;
  success: boolean;
}

function paymentIdFrom(r: KbResponse): string | null {
  const fromLocation = r.location?.match(/\/payments\/([0-9a-f-]{36})/)?.[1];
  if (fromLocation) return fromLocation;
  return isObject(r.json) ? str(r.json["paymentId"]) : null;
}

async function transactionStatus(paymentId: string, kind: "PURCHASE" | "REFUND"): Promise<string | null> {
  const r = await call("GET", `/1.0/kb/payments/${paymentId}`);
  if (r.status !== 200 || !isObject(r.json)) return null;
  const txs = Array.isArray(r.json["transactions"]) ? r.json["transactions"] : [];
  const matching = txs.filter((t): t is Record<string, unknown> => isObject(t) && t["transactionType"] === kind);
  const last = matching[matching.length - 1];
  return last ? str(last["status"]) : null;
}

export async function purchase(accountId: string, cents: number, paymentExternalKey: string): Promise<PaymentOutcome> {
  const body = `{"transactionType":"PURCHASE","amount":${dollars(cents)},"currency":"USD","paymentExternalKey":${JSON.stringify(paymentExternalKey)}}`;
  const r = await call("POST", `/1.0/kb/accounts/${accountId}/payments`, body);
  const paymentId = paymentIdFrom(r);
  if (r.status !== 201 || paymentId === null) return { paymentId, success: false };
  return { paymentId, success: (await transactionStatus(paymentId, "PURCHASE")) === "SUCCESS" };
}

export async function refund(paymentId: string, cents: number): Promise<boolean> {
  const body = `{"transactionType":"REFUND","amount":${dollars(cents)},"currency":"USD"}`;
  const r = await call("POST", `/1.0/kb/payments/${paymentId}/refunds`, body);
  if (r.status !== 201) return false;
  return (await transactionStatus(paymentId, "REFUND")) === "SUCCESS";
}
