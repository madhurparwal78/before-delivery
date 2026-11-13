import { config } from "./config.js";

export type SmsTemplate = "signin_code" | "signup_code" | "reset_code" | "signup_existing";

export interface SmsResult { ok: boolean }

export interface ProviderStatus { ok: boolean }

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 5000): Promise<{ status: number; json: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(url: string, headers: Record<string, string>, timeoutMs = 5000): Promise<{ status: number; json: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendSms(to: string, template: SmsTemplate, code?: string): Promise<SmsResult> {
  if (!config.wiremock.url) return { ok: false };
  const body: Record<string, string> = { to, template, sender: "CHRAHA" };
  if (code !== undefined) body.code = code;
  const res = await postJson(`${config.wiremock.url}/sms/v1/messages`, body, {});
  if (!res) return { ok: false };
  const ok = res.status >= 200 && res.status < 300;
  return { ok };
}

export type ProviderPayStatus = "PENDING" | "SUCCESS" | "FAILED";

export async function startUpiCollect(reference: string, vpa: string, amountPaise: number, expiresIn: number): Promise<ProviderPayStatus | null> {
  const res = await postJson(`${config.wiremock.url}/upi/v1/collect`, {
    reference, vpa, amount_paise: amountPaise, expires_in_seconds: expiresIn,
  }, {});
  if (!res || res.status < 200 || res.status >= 300) return null;
  const status = (res.json as { status?: string } | null)?.status;
  return status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING";
}

export async function upiStatus(reference: string): Promise<ProviderPayStatus | null> {
  const res = await getJson(`${config.wiremock.url}/upi/v1/collect/${encodeURIComponent(reference)}`, {});
  if (!res || res.status < 200 || res.status >= 300) return null;
  const status = (res.json as { status?: string } | null)?.status;
  return status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING";
}

export async function startNetBanking(reference: string, bankCode: string, amountPaise: number): Promise<ProviderPayStatus | null> {
  const res = await postJson(`${config.wiremock.url}/netbanking/v1/payments`, {
    reference, bank_code: bankCode, amount_paise: amountPaise,
  }, {});
  if (!res || res.status < 200 || res.status >= 300) return null;
  const status = (res.json as { status?: string } | null)?.status;
  return status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING";
}

export async function netBankingStatus(reference: string): Promise<ProviderPayStatus | null> {
  const res = await getJson(`${config.wiremock.url}/netbanking/v1/payments/${encodeURIComponent(reference)}`, {});
  if (!res || res.status < 200 || res.status >= 300) return null;
  const status = (res.json as { status?: string } | null)?.status;
  return status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING";
}
