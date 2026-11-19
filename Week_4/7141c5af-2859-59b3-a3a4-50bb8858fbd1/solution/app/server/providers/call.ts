import { one, query } from "../db/pool.ts";

const PROVIDER_WAIT_MS = 5000;

/** A provider that could not be reached, timed out or answered 5xx. Callers turn it into their published 503. */
export class ProviderDown extends Error {}

/** One call to a provider, waiting at most 5 seconds. */
export async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_WAIT_MS) });
    if (response.status >= 500) throw new ProviderDown(`${url} answered ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof ProviderDown) throw error;
    throw new ProviderDown(`${url} failed`);
  }
}

type WaitingProvider = "supplier" | "courier";

/** The Retry-After instant still ahead for a provider, if any. */
export async function waitUntil(provider: WaitingProvider): Promise<Date | null> {
  const row = await one<{ until: Date }>("SELECT until FROM provider_waits WHERE provider = $1 AND until > now()", [provider]);
  return row?.until ?? null;
}

/** Keeps a 429's Retry-After, given in seconds or as a date. */
export async function rememberWait(provider: WaitingProvider, retryAfter: string | null): Promise<Date> {
  const seconds = Number(retryAfter);
  const parsed = retryAfter === null ? Number.NaN : Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter);
  const until = new Date(Number.isFinite(parsed) ? parsed : Date.now());
  await query(
    "INSERT INTO provider_waits (provider, until) VALUES ($1, $2) ON CONFLICT (provider) DO UPDATE SET until = EXCLUDED.until",
    [provider, until],
  );
  return until;
}
