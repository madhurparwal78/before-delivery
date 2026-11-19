// Kill Bill: one account per fan email, purchases and refunds. SUCCESS confirms; no answer within 10 s,
// a connection failure or a 5xx is "unreachable"; any other answer is a decline.
import { config } from "./config.js";
import { pool } from "./db.js";

export type KillBillResult<T> = { kind: "confirmed"; value: T } | { kind: "declined" } | { kind: "unreachable" };

type Answer = { kind: "answer"; status: number; location: string | null; json: unknown } | { kind: "unreachable" };

const TIMEOUT_MS = 10_000;
const auth = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Answer> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: auth,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "seatwise",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.status >= 500) return { kind: "unreachable" };
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { kind: "answer", status: response.status, location: response.headers.get("location"), json };
  } catch {
    return { kind: "unreachable" };
  }
}

const lastSegment = (location: string | null): string | null => location?.split("?")[0]?.split("/").filter(Boolean).pop() ?? null;

/** `9736` → `"97.36"`: whole cents to the decimal dollars Kill Bill takes, without floating point. */
function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

interface AccountJson {
  accountId?: string;
  paymentMethodId?: string | null;
}

interface PaymentJson {
  paymentId?: string;
  transactions?: { transactionExternalKey?: string; status?: string }[];
}

async function addDefaultPaymentMethod(accountId: string): Promise<KillBillResult<string>> {
  const added = await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, {
    accountId, pluginName: "__EXTERNAL_PAYMENT__", isDefault: true,
  });
  if (added.kind === "unreachable") return added;
  return added.status === 201 ? { kind: "confirmed", value: accountId } : { kind: "declined" };
}

async function findAccount(externalKey: string): Promise<KillBillResult<AccountJson | null>> {
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.kind === "unreachable") return found;
  if (found.status === 404) return { kind: "confirmed", value: null };
  return found.status === 200 ? { kind: "confirmed", value: found.json as AccountJson } : { kind: "declined" };
}

/** The fan's account (external key = email in lower case), created with a default external payment method. */
export async function ensureAccount(email: string, name: string): Promise<KillBillResult<string>> {
  const externalKey = email.toLowerCase();
  const known = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM killbill_accounts WHERE external_key = $1", [externalKey]);
  if (known.rows[0]) return { kind: "confirmed", value: known.rows[0].account_id };

  // Create first: a new fan is the common case, so this skips a lookup round trip; an existing key is refused and looked up.
  const created = await call("POST", "/accounts", { name, email: externalKey, externalKey, currency: "USD" });
  if (created.kind === "unreachable") return created;
  let found: KillBillResult<AccountJson | null>;
  if (created.status === 201 && lastSegment(created.location)) {
    found = { kind: "confirmed", value: { accountId: lastSegment(created.location)!, paymentMethodId: null } };
  } else {
    found = await findAccount(externalKey);
    if (found.kind !== "confirmed") return found;
    if (!found.value) return { kind: "declined" };
  }
  const account = found.value;
  if (!account?.accountId) return { kind: "declined" };
  if (!account.paymentMethodId) {
    const method = await addDefaultPaymentMethod(account.accountId);
    if (method.kind !== "confirmed") return method;
  }
  await pool.query("INSERT INTO killbill_accounts (external_key, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [externalKey, account.accountId]);
  return { kind: "confirmed", value: account.accountId };
}

/** Reads the payment back and confirms only a SUCCESS transaction with the key we sent. */
async function confirmedTransaction(paymentId: string | null, transactionKey: string): Promise<KillBillResult<string>> {
  if (!paymentId) return { kind: "declined" };
  const read = await call("GET", `/payments/${paymentId}`);
  if (read.kind === "unreachable") return read;
  const payment = read.json as PaymentJson | null;
  const transaction = payment?.transactions?.find((t) => t.transactionExternalKey === transactionKey);
  return read.status === 200 && transaction?.status === "SUCCESS" ? { kind: "confirmed", value: paymentId } : { kind: "declined" };
}

/** One PURCHASE transaction on a new payment; the value is Kill Bill's payment id. */
export async function purchase(accountId: string, cents: number, paymentKey: string, transactionKey: string): Promise<KillBillResult<string>> {
  const sent = await call("POST", `/accounts/${accountId}/payments`, {
    transactionType: "PURCHASE", amount: dollars(cents), currency: "USD",
    paymentExternalKey: paymentKey, transactionExternalKey: transactionKey,
  });
  if (sent.kind === "unreachable") return sent;
  if (sent.status !== 201) return { kind: "declined" };
  return confirmedTransaction(lastSegment(sent.location), transactionKey);
}

/** One REFUND transaction against an existing payment. */
export async function refund(paymentId: string, cents: number, transactionKey: string): Promise<KillBillResult<string>> {
  const sent = await call("POST", `/payments/${paymentId}/refunds`, {
    transactionType: "REFUND", amount: dollars(cents), currency: "USD", transactionExternalKey: transactionKey,
  });
  if (sent.kind === "unreachable") return sent;
  if (sent.status !== 201) return { kind: "declined" };
  return confirmedTransaction(paymentId, transactionKey);
}
