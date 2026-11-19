import { decimalPounds } from "../shared/money.js";
import { config } from "./config.js";
import { call } from "./status.js";

// Kill Bill holds, captures and releases every pledge (brief: Services › Kill Bill). Its confirmed
// transaction status is the source of truth: each write is read back and checked for SUCCESS.

type TransactionType = "AUTHORIZE" | "CAPTURE" | "VOID";

interface KbTransaction {
  transactionType: string;
  status: string;
  transactionExternalKey: string;
}

const base = `${config.killbill.url}/1.0/kb`;
const auth = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

async function kb(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await call("payments", `${base}${path}`, {
    method,
    headers: {
      Authorization: auth,
      "X-Killbill-ApiKey": config.killbill.apiKey,
      "X-Killbill-ApiSecret": config.killbill.apiSecret,
      "X-Killbill-CreatedBy": "dotgain",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status >= 400 && response.status !== 404) {
    throw new Error(`Kill Bill ${method} ${path.split("?")[0]} answered ${response.status}`);
  }
  return response;
}

function createdId(response: Response): string {
  const location = response.headers.get("location") ?? "";
  const id = location.split("?")[0].replace(/\/+$/, "").split("/").pop();
  if (!id) throw new Error("Kill Bill created a resource without a Location");
  return id;
}

async function confirmed(paymentId: string, type: TransactionType, transactionKey: string): Promise<void> {
  const payment = (await (await kb("GET", `/payments/${paymentId}`)).json()) as { transactions?: KbTransaction[] };
  const ok = (payment.transactions ?? []).some(
    (t) => t.transactionType === type && t.transactionExternalKey === transactionKey && t.status === "SUCCESS",
  );
  if (!ok) throw new Error(`Kill Bill did not confirm ${type} ${transactionKey}`);
}

/**
 * The backer's account (externalKey = person id, GBP), created on their first pledge. `fresh` means the person
 * was created in this request, so no account can exist yet and the lookup is skipped.
 */
export async function ensureAccount(person: { id: string; name: string; email: string }, fresh = false): Promise<string> {
  if (!fresh) {
    const found = await kb("GET", `/accounts?externalKey=${encodeURIComponent(person.id)}`);
    if (found.status === 200) return ((await found.json()) as { accountId: string }).accountId;
    await found.body?.cancel();
  }
  const made = await kb("POST", "/accounts", { externalKey: person.id, name: person.name, email: person.email, currency: "GBP" });
  return createdId(made);
}

/**
 * The account's __EXTERNAL_PAYMENT__ payment method for a card entry. Kill Bill accepts one such method per account
 * and keeps earlier holds capturable only while it exists, so it is added on the first card entry. A `fresh`
 * account (just created) has none yet, so the listing is skipped.
 */
export async function cardMethod(accountId: string, fresh = false): Promise<string> {
  if (!fresh) {
    const listed = (await (await kb("GET", `/accounts/${accountId}/paymentMethods`)).json()) as { paymentMethodId: string; pluginName: string }[];
    const external = listed.find((m) => m.pluginName === "__EXTERNAL_PAYMENT__");
    if (external) return external.paymentMethodId;
  }
  const made = await kb("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} });
  return createdId(made);
}

/** A new payment holding an AUTHORIZE for the full amount; returns the payment id once confirmed. */
export async function authorize(accountId: string, paymentMethodId: string, paymentKey: string, pence: number): Promise<string> {
  const transactionKey = `${paymentKey}-auth`;
  const made = await kb("POST", `/accounts/${accountId}/payments?paymentMethodId=${paymentMethodId}`, {
    transactionType: "AUTHORIZE",
    amount: decimalPounds(pence),
    currency: "GBP",
    paymentExternalKey: paymentKey,
    transactionExternalKey: transactionKey,
  });
  const paymentId = createdId(made);
  await confirmed(paymentId, "AUTHORIZE", transactionKey);
  return paymentId;
}

export async function capture(paymentId: string, paymentKey: string, pence: number): Promise<void> {
  const transactionKey = `${paymentKey}-capture`;
  await kb("POST", `/payments/${paymentId}`, { amount: decimalPounds(pence), currency: "GBP", transactionExternalKey: transactionKey });
  await confirmed(paymentId, "CAPTURE", transactionKey);
}

export async function release(paymentId: string, paymentKey: string): Promise<void> {
  const transactionKey = `${paymentKey}-void`;
  await kb("DELETE", `/payments/${paymentId}`, { transactionExternalKey: transactionKey });
  await confirmed(paymentId, "VOID", transactionKey);
}

/** Reachability only: Kill Bill's own healthcheck also fails while its queues are busy, which is not an outage. */
export async function probe(): Promise<void> {
  await (await kb("GET", "/nodesInfo")).body?.cancel();
}
