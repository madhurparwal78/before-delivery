// The roadworthiness-record API. The app calls it with no credentials and no query parameters.

import { config } from '../config.js';
import type { RecordPayload } from '../domain/record.js';

type PullResult =
  | { kind: 'ok'; payload: RecordPayload }
  | { kind: 'not_found' }
  | { kind: 'throttled'; retryAfterSeconds: number }
  | { kind: 'unreachable' };

const TIMEOUT_MS = 5000;
const DEFAULT_RETRY_SECONDS = 60;

export async function pullRecord(registration: string): Promise<PullResult> {
  const url = `${config.recordApiUrl}/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`;
  let reply: Response;
  try {
    reply = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { kind: 'unreachable' };
  }
  if (reply.status === 404) {
    await reply.text().catch(() => undefined);
    return { kind: 'not_found' };
  }
  if (reply.status === 429) {
    await reply.text().catch(() => undefined);
    const header = Number(reply.headers.get('retry-after'));
    return {
      kind: 'throttled',
      retryAfterSeconds: Number.isFinite(header) && header > 0 ? Math.floor(header) : DEFAULT_RETRY_SECONDS,
    };
  }
  if (!reply.ok) {
    await reply.text().catch(() => undefined);
    return { kind: 'unreachable' };
  }
  try {
    const payload = (await reply.json()) as RecordPayload;
    if (!payload || !Array.isArray(payload.motTests)) return { kind: 'unreachable' };
    return { kind: 'ok', payload };
  } catch {
    return { kind: 'unreachable' };
  }
}

export async function recordApiReachable(): Promise<boolean> {
  try {
    const reply = await fetch(`${config.recordApiUrl}/v1/trade/vehicles/registration/S482KVT`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await reply.text().catch(() => undefined);
    return reply.ok;
  } catch {
    return false;
  }
}
