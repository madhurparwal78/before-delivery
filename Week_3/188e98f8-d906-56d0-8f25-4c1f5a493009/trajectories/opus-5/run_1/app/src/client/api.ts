/** Talking to the desk's own server. */

import type { ApiError } from '../shared/model.js';

export type Outcome<Data> =
  | { ok: true; status: number; data: Data; headers: Headers }
  | { ok: false; status: number; error: ApiError | null };

const SIGNED_OUT_FLAG = 'roundkeeper.signed-out';

function returnToSignIn(): void {
  window.sessionStorage.setItem(SIGNED_OUT_FLAG, 'yes');
  window.location.assign('/sign-in');
}

export function tookSignedOutCopy(): boolean {
  const held = window.sessionStorage.getItem(SIGNED_OUT_FLAG);
  if (held === null) return false;
  window.sessionStorage.removeItem(SIGNED_OUT_FLAG);
  return true;
}

interface Ask {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  bytes?: { data: ArrayBuffer; contentType: string };
  idempotencyKey?: string;
  /** A signed-out answer on a public read leaves the screen where it is. */
  publicRead?: boolean;
}

export async function ask<Data>(request: Ask): Promise<Outcome<Data>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (request.bytes !== undefined) {
    headers['Content-Type'] = request.bytes.contentType;
    body = request.bytes.data;
  } else if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(request.body);
  }
  if (request.idempotencyKey !== undefined) headers['Idempotency-Key'] = request.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(request.path, {
      method: request.method,
      headers,
      body,
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, status: 0, error: null };
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: undefined as Data, headers: response.headers };
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (response.ok) return { ok: true, status: response.status, data: parsed as Data, headers: response.headers };

  const error = parsed as ApiError | null;
  if (response.status === 401 && error?.error === 'signed_out' && request.publicRead !== true) {
    returnToSignIn();
  }
  return { ok: false, status: response.status, error };
}

export function freshIdempotencyKey(): string {
  return crypto.randomUUID();
}
