import { config } from "../config";
import { dollarsJson } from "../money";

// Kill Bill client. Every id used in a Kill Bill key is a random UUID unique across
// databases. All studios share the configured tenant.

export type KbCallResult = "success" | "timeout" | "error";

// "timeout" means the call was sent but no answer arrived in time; "error" means the
// connection could not be made or Kill Bill answered with an error.
function classify(e: unknown): "timeout" | "error" {
  if (e instanceof Error && e.name === "AbortError") return "timeout";
  return "error";
}

export class KbCallFailed extends Error {
  kind: "timeout" | "error";
  constructor(kind: "timeout" | "error") {
    super(kind === "timeout" ? "Kill Bill did not answer in time" : "Kill Bill could not be reached or failed the call");
    this.kind = kind;
  }
}

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    "X-Killbill-ApiKey": config.killbillApiKey,
    "X-Killbill-ApiSecret": config.killbillApiSecret,
    "X-Killbill-CreatedBy": "kiln-desk",
    "Content-Type": "application/json",
  };
}

async function kbFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${config.killbillUrl}${path}`, { ...init, headers: authHeaders(), signal: controller.signal });
  } catch (e) {
    throw new KbCallFailed(classify(e));
  } finally {
    clearTimeout(timer);
  }
}

async function getAccountId(memberId: string, timeoutMs: number): Promise<string | null> {
  const res = await kbFetch(`/1.0/kb/accounts?externalKey=kd-${encodeURIComponent(memberId)}&withAccountInfo=false`, { method: "GET" }, timeoutMs);
  if (res.status === 404) return null;
  if (!res.ok) throw new KbCallFailed("error");
  const account = (await res.json()) as { accountId: string };
  return account.accountId;
}

export async function ensureAccount(member: { id: string; name: string; email: string }, timeoutMs = 5000): Promise<void> {
  const existing = await getAccountId(member.id, timeoutMs);
  if (existing) return;
  const body = JSON.stringify({ externalKey: `kd-${member.id}`, name: member.name, email: member.email, currency: "USD" });
  const created = await kbFetch("/1.0/kb/accounts", { method: "POST", body }, timeoutMs);
  if (created.ok || created.status === 409) {
    if ((await getAccountId(member.id, timeoutMs)) !== null) return;
  }
  throw new KbCallFailed("error");
}

async function paymentMethodIdForMember(memberId: string, timeoutMs: number): Promise<string> {
  const accountId = await getAccountId(memberId, timeoutMs);
  if (!accountId) throw new KbCallFailed("error");
  const listRes = await kbFetch(`/1.0/kb/accounts/${accountId}/paymentMethods?withPluginInfo=false`, { method: "GET" }, timeoutMs);
  if (!listRes.ok) throw new KbCallFailed("error");
  const methods = (await listRes.json()) as { paymentMethodId: string; externalKey: string }[];
  const mine = methods.find((m) => m.externalKey === `kd-${memberId}-card`);
  if (mine) return mine.paymentMethodId;
  if (methods.length > 0) return methods[0].paymentMethodId;
  const create = await kbFetch(
    `/1.0/kb/accounts/${accountId}/paymentMethods`,
    { method: "POST", body: JSON.stringify({ externalKey: `kd-${memberId}-card`, isDefault: true, pluginName: "__EXTERNAL_PAYMENT__" }) },
    timeoutMs,
  );
  const location = create.headers.get("Location") ?? "";
  const id = location.split("/").filter(Boolean).pop();
  if (create.ok && id !== undefined) return id;
  throw new KbCallFailed("error");
}

type KbPayment = { paymentId: string; transactions: { transactionExternalKey: string; status: string; transactionType: string }[] };

async function paymentByKey(txKey: string, timeoutMs: number): Promise<KbPayment | null> {
  const res = await kbFetch(`/1.0/kb/payments?externalKey=${encodeURIComponent(txKey)}&withPluginInfo=false&withAttemptsInfo=false`, { method: "GET" }, timeoutMs);
  if (res.status === 404) return null;
  if (!res.ok) throw new KbCallFailed("error");
  return (await res.json()) as KbPayment;
}

// Adoption: a successful PURCHASE already recorded under the transaction key.
export async function lookupPurchase(txKey: string, timeoutMs = 30000): Promise<boolean> {
  const payment = await paymentByKey(txKey, timeoutMs);
  if (!payment) return false;
  return payment.transactions.some((t) => t.transactionExternalKey === txKey && t.status === "SUCCESS" && t.transactionType === "PURCHASE");
}

export async function lookupRefund(refundTxKey: string, chargeTxKey: string, timeoutMs = 30000): Promise<boolean> {
  const payment = await paymentByKey(chargeTxKey, timeoutMs);
  if (!payment) return false;
  return payment.transactions.some((t) => t.transactionExternalKey === refundTxKey && t.status === "SUCCESS");
}

export type PurchaseOutcome = { result: KbCallResult; paymentId?: string };

export async function purchase(
  member: { id: string; name: string; email: string },
  txKey: string,
  amountCents: number,
  timeoutMs: number,
): Promise<PurchaseOutcome> {
  await ensureAccount(member, timeoutMs);
  const pmId = await paymentMethodIdForMember(member.id, timeoutMs);
  const accountId = await getAccountId(member.id, timeoutMs);
  if (!accountId) throw new KbCallFailed("error");
  const body = `{"transactionType":"PURCHASE","amount":${dollarsJson(amountCents)},"currency":"USD","transactionExternalKey":"${txKey}","paymentExternalKey":"${txKey}"}`;
  const res = await kbFetch(`/1.0/kb/accounts/${accountId}/payments?paymentMethodId=${pmId}`, { method: "POST", body }, timeoutMs);
  if (res.status === 201) {
    const loc = res.headers.get("Location") ?? "";
    const paymentId = loc.split("/").filter(Boolean).pop();
    return { result: "success", paymentId };
  }
  if (res.status === 400 && (await lookupPurchase(txKey, timeoutMs))) {
    return { result: "success" };
  }
  throw new KbCallFailed("error");
}

export async function refund(chargeTxKey: string, refundTxKey: string, amountCents: number, timeoutMs: number): Promise<KbCallResult> {
  const payment = await paymentByKey(chargeTxKey, timeoutMs);
  if (!payment) throw new KbCallFailed("error");
  const body = `{"transactionType":"REFUND","amount":${dollarsJson(amountCents)},"currency":"USD","transactionExternalKey":"${refundTxKey}"}`;
  const res = await kbFetch(`/1.0/kb/payments/${payment.paymentId}/refunds`, { method: "POST", body }, timeoutMs);
  if (res.status === 201) return "success";
  if (res.status === 400 && (await lookupRefund(refundTxKey, chargeTxKey, timeoutMs))) return "success";
  throw new KbCallFailed("error");
}
