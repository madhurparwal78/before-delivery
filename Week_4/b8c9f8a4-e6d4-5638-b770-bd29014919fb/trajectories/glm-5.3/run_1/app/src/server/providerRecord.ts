import type { Config } from './db.js';
import type { ProviderRecord, ProviderTest } from './record.js';

export type PullFailure =
  | { kind: 'not_found'; retryAfterSeconds?: undefined }
  | { kind: 'throttled'; retryAfterSeconds: number }
  | { kind: 'unreachable'; retryAfterSeconds?: undefined };

/** One call to the roadworthiness-record API for a stored registration. */
export async function pullRecord(cfg: Config, registration: string): Promise<{ record: ProviderRecord } | { failure: PullFailure }> {
  const url = `${cfg.wiremockUrl}/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`;
  try {
    const reply = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (reply.status === 404) return { failure: { kind: 'not_found' } };
    if (reply.status === 429) {
      const retryHeader = reply.headers.get('retry-after');
      const seconds = /^\d+$/.test(retryHeader ?? '') ? parseInt(retryHeader as string, 10) : 60;
      return { failure: { kind: 'throttled', retryAfterSeconds: seconds } };
    }
    if (reply.status >= 500) return { failure: { kind: 'unreachable' } };
    const body = (await reply.json()) as ProviderRecord;
    if (!body || !Array.isArray(body.motTests)) return { failure: { kind: 'unreachable' } };
    return { record: body };
  } catch {
    return { failure: { kind: 'unreachable' } };
  }
}
