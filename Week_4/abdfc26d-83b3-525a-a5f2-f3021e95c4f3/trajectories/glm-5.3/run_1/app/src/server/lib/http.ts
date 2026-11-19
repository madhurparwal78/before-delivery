import { AppError } from '../../errors.js';

export interface FetchResult {
  status: number;
  body: string;
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body };
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(`request_failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function unreachable(err: unknown, what: string): AppError {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith('request_failed:') || msg === 'This operation was aborted') {
    console.warn(`[provider] ${what} unreachable`);
  }
  return AppError.providerUnavailable();
}

export async function readJson(res: FetchResult): Promise<unknown> {
  try {
    return JSON.parse(res.body) as unknown;
  } catch {
    throw new Error('bad_json');
  }
}

export function unreachableCopy(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
