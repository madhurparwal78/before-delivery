// API wrapper: JSON calls, the server-clock offset, and the error shape.

export type ApiErrorShape = { code: string; message: string; fields?: Record<string, string> };

export class ApiCallError extends Error {
  constructor(readonly status: number, readonly error: ApiErrorShape) {
    super(error.code);
  }
}

export class NetworkError extends Error {
  constructor() {
    super("network");
  }
}

/** The offset between the server's clock (Date header) and ours, in ms. */
let serverClockOffsetMs = 0;

export function serverNow(): number {
  return Date.now() + serverClockOffsetMs;
}

export function holdLapsed(holdExpiresIso: string): boolean {
  return serverNow() >= Date.parse(holdExpiresIso);
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string> } = {}): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetworkError();
  }
  const date = res.headers.get("date");
  if (date) serverClockOffsetMs = Date.parse(date) - Date.now();
  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok && data && typeof data === "object" && (data as { error?: unknown }).error) {
    const err = (data as { error: ApiErrorShape }).error;
    throw new ApiCallError(res.status, err);
  }
  return { status: res.status, data: data as T };
}

export async function apiRaw(method: string, path: string, body: ArrayBuffer, contentType: string): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: { "content-type": contentType }, body });
  } catch {
    throw new NetworkError();
  }
  const date = res.headers.get("date");
  if (date) serverClockOffsetMs = Date.parse(date) - Date.now();
  const text = await res.text();
  let data: any = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok && data?.error) throw new ApiCallError(res.status, data.error);
  return { status: res.status, data };
}

export function randomTicket(prefix: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = prefix;
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function randomStream(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
