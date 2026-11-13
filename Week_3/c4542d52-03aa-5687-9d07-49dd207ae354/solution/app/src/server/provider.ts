import { config } from "./config.js";
import type { PaymentRecord } from "../shared/types.js";

const ANSWER_MS = 5000;

export class ProviderUnreachable extends Error {}

type CreatedPayment = { id: string; status: string; amount_cents: number; currency: string; reference: string };

async function call(method: "GET" | "POST", path: string, body?: string, key?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  let response: Response;
  try {
    response = await fetch(`${config.providerUrl}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  } catch {
    throw new ProviderUnreachable();
  }
  if (!response.ok) throw new ProviderUnreachable();
  try {
    return await response.json();
  } catch {
    throw new ProviderUnreachable();
  }
}

export async function createPayment(
  order: { id: string; grantId: string; options: number; costCents: bigint; key: string },
): Promise<CreatedPayment> {
  const details = JSON.stringify({
    currency: "USD",
    reference: order.id,
    description: `Exercise of ${order.options} options under ${order.grantId}`,
  });
  // The amount is spliced in as exact digits so it never passes through a binary float.
  const body = `{"amount_cents":${order.costCents},${details.slice(1)}`;
  const created = await call("POST", "/v1/payments", body, order.key);
  return created as CreatedPayment;
}

export async function fetchPayment(paymentId: string): Promise<PaymentRecord> {
  return (await call("GET", `/v1/payments/${encodeURIComponent(paymentId)}`)) as PaymentRecord;
}

export async function cancelPayment(paymentId: string): Promise<void> {
  await call("POST", `/v1/payments/${encodeURIComponent(paymentId)}/cancel`, "{}");
}
