import { config } from "../config.js";
import { one, query } from "../db.js";
import { ledgerAmount } from "../domain/money.js";
import { ProviderUnavailable, providerFetch } from "./provider.js";

const BASE = `${config.killbill.url}/1.0/kb`;

function headers(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    "X-Killbill-CreatedBy": "chauraha-bazaar",
    "Content-Type": "application/json",
  };
}

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return providerFetch(`${BASE}${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
}

interface KillBillTransaction {
  transactionType: string;
  status: string;
  transactionExternalKey: string;
  amount: number;
}

interface KillBillPayment {
  paymentId: string;
  transactions: KillBillTransaction[];
}

async function findPayment(paymentKey: string): Promise<KillBillPayment | null> {
  try {
    return (await (await send("GET", `/payments?externalKey=${encodeURIComponent(paymentKey)}`)).json()) as KillBillPayment;
  } catch (error) {
    if (error instanceof ProviderUnavailable && error.message.endsWith("answered 404")) return null;
    throw error;
  }
}

async function findAccount(externalKey: string): Promise<string | null> {
  try {
    const found = (await (await send("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`)).json()) as { accountId: string };
    return found.accountId;
  } catch (error) {
    if (error instanceof ProviderUnavailable && error.message.endsWith("answered 404")) return null;
    throw error;
  }
}

/** One Kill Bill account per shopper, keyed `shopper-<account id>`, with the external payment method as default. */
async function ensureAccount(accountId: string): Promise<string> {
  const cached = await one<{ kb_account_id: string | null; name: string; email: string }>(
    "SELECT kb_account_id, name, email FROM accounts WHERE id = $1",
    [accountId],
  );
  if (cached?.kb_account_id) return cached.kb_account_id;
  const externalKey = `shopper-${accountId}`;
  let kbAccountId = await findAccount(externalKey);
  if (kbAccountId === null) {
    try {
      await send("POST", "/accounts", { externalKey, currency: "INR", name: cached?.name, email: cached?.email });
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
    kbAccountId = await findAccount(externalKey);
    if (kbAccountId === null) throw new ProviderUnavailable("account was not created");
    await send("POST", `/accounts/${kbAccountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} });
  }
  await query("UPDATE accounts SET kb_account_id = $2 WHERE id = $1", [accountId, kbAccountId]);
  return kbAccountId;
}

/** Records a PURCHASE once per payment external key. */
export async function recordPurchase(accountId: string, paymentKey: string, amountPaise: number): Promise<void> {
  const existing = await findPayment(paymentKey);
  if (existing?.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS")) return;
  const kbAccountId = await ensureAccount(accountId);
  await send("POST", `/accounts/${kbAccountId}/payments`, {
    transactionType: "PURCHASE",
    amount: ledgerAmount(amountPaise),
    currency: "INR",
    paymentExternalKey: paymentKey,
    transactionExternalKey: `${paymentKey}-purchase`,
  });
}

/** Records a REFUND once per transaction external key (the refund id). */
export async function recordRefund(paymentKey: string, refundKey: string, amountPaise: number): Promise<void> {
  const payment = await findPayment(paymentKey);
  if (payment === null) throw new ProviderUnavailable(`${paymentKey} is not recorded yet`);
  if (payment.transactions.some((t) => t.transactionType === "REFUND" && t.transactionExternalKey === refundKey && t.status === "SUCCESS")) return;
  await send("POST", `/payments/${payment.paymentId}/refunds`, { amount: ledgerAmount(amountPaise), transactionExternalKey: refundKey });
}
