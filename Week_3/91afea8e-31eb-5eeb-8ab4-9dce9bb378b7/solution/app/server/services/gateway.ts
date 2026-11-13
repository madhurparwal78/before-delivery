import { config } from "../config.js";
import type { ProviderStatus } from "../domain/state.js";
import { providerFetch } from "./provider.js";

export type SmsTemplate = "signin_code" | "signup_code" | "reset_code" | "signup_existing";

function post(path: string, body: Record<string, unknown>): Promise<Response> {
  return providerFetch(`${config.wiremockUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PAYMENT_PATHS = { upi: "/upi/v1/collect", netbanking: "/netbanking/v1/payments" } as const;

/** Reads a UPI collect or net-banking payment's status; anything but SUCCESS or FAILED is still pending. */
export async function providerStatus(method: keyof typeof PAYMENT_PATHS, paymentId: string): Promise<ProviderStatus> {
  const response = await providerFetch(`${config.wiremockUrl}${PAYMENT_PATHS[method]}/${encodeURIComponent(paymentId)}`);
  const body = (await response.json()) as { status?: string };
  return body.status === "SUCCESS" || body.status === "FAILED" ? body.status : "PENDING";
}

export async function sendText(to: string, template: SmsTemplate, code: string | null): Promise<void> {
  await post("/sms/v1/messages", { to, template, ...(code === null ? {} : { code }), sender: "CHRAHA" });
}

export async function startUpi(paymentId: string, vpa: string, amountPaise: number, expiresInSeconds: number): Promise<void> {
  await post(PAYMENT_PATHS.upi, { reference: paymentId, vpa, amount_paise: amountPaise, expires_in_seconds: expiresInSeconds });
}


export async function startNetbanking(paymentId: string, bankCode: string, amountPaise: number): Promise<void> {
  await post(PAYMENT_PATHS.netbanking, { reference: paymentId, bank_code: bankCode, amount_paise: amountPaise });
}
