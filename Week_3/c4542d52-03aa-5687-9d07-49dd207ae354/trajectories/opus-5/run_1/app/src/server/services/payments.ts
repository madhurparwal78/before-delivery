import type { PaymentRecord } from "../../shared/types.js";
import { config } from "../config.js";

const TIMEOUT_MS = 5000;

export class ProviderUnavailableError extends Error {}

function isPaymentRecord(value: unknown): value is PaymentRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["status"] === "string" &&
    typeof record["amount_cents"] === "number" &&
    typeof record["currency"] === "string" &&
    typeof record["reference"] === "string"
  );
}

async function readRecord(response: Response): Promise<PaymentRecord> {
  if (!response.ok) throw new ProviderUnavailableError(`the provider answered ${response.status}`);
  const body: unknown = await response.json().catch(() => null);
  if (!isPaymentRecord(body)) throw new ProviderUnavailableError("the provider answered an unreadable record");
  return { ...body, confirmed_at: typeof body.confirmed_at === "string" ? body.confirmed_at : null };
}

export interface PaymentRequest {
  idempotencyKey: string;
  amountCents: number;
  reference: string;
  description: string;
}

export async function createPayment(request: PaymentRequest): Promise<PaymentRecord> {
  let response: Response;
  try {
    response = await fetch(`${config.paymentProviderUrl}/v1/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
      body: JSON.stringify({
        amount_cents: request.amountCents,
        currency: "USD",
        reference: request.reference,
        description: request.description,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderUnavailableError(String(error));
  }
  return readRecord(response);
}

export async function fetchPayment(paymentId: string): Promise<PaymentRecord> {
  let response: Response;
  try {
    response = await fetch(`${config.paymentProviderUrl}/v1/payments/${encodeURIComponent(paymentId)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderUnavailableError(String(error));
  }
  return readRecord(response);
}

export async function cancelPayment(paymentId: string): Promise<void> {
  try {
    await fetch(`${config.paymentProviderUrl}/v1/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // A payment the provider cannot be told about stays cancelled on the register.
  }
}
