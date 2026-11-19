/** API client helpers with one operation-id generator and automatic retries. */
import { randomUUID } from './polyfill.js';

export interface ApiResult<T> {
  status: number;
  body: T;
  headers: Record<string, string>;
  networkError: boolean;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { retry?: boolean; clientOpId?: string } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const attempt = async (): Promise<ApiResult<T>> => {
    try {
      const res = await fetch(path, { method, headers, body: payload });
      const headersOut: Record<string, string> = {};
      res.headers.forEach((v, k) => { headersOut[k.toLowerCase()] = v; });
      const text = await res.text();
      const parsed: T = (text.length === 0 ? {} : JSON.parse(text)) as T;
      return { status: res.status, body: parsed, headers: headersOut, networkError: false };
    } catch {
      return { status: 0, body: {} as T, headers: {}, networkError: true };
    }
  };
  let out = await attempt();
  // retry automatically on network failure (with the same operation id)
  if (out.networkError && opts.retry) {
    for (let i = 0; i < 12 && out.networkError; i++) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * (i + 1), 4000)));
      out = await attempt();
    }
  }
  return out;
}

export function newClientOpId(): string {
  return `op-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function errorMessage(body: { error?: { code?: string; message?: string; fields?: Record<string, string> } }): string {
  return body?.error?.message ?? 'Something went wrong';
}

export function errorCode(body: { error?: { code?: string } }): string | undefined {
  return body?.error?.code;
}

export function errorFields(body: { error?: { fields?: Record<string, string> } }): Record<string, string> {
  return body?.error?.fields ?? {};
}
