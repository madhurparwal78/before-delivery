import type { ApiErrorBody } from '../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.error.code;
  }

  fieldMessage(field: string): string | undefined {
    return this.body.error.fields?.[field];
  }

  /** The message to show beside a control: the field message when there is one. */
  controlMessage(field?: string): string {
    if (field !== undefined) {
      const fields = this.body.error.fields;
      const specific = fields?.[field];
      if (specific !== undefined) return specific;
    }
    const fields = this.body.error.fields;
    if (fields !== undefined) {
      const first = Object.values(fields)[0];
      if (first !== undefined) return first;
    }
    return this.body.error.message;
  }
}

type OutageListener = (provider: 'payments' | 'storage') => void;

const outageListeners: OutageListener[] = [];

export function onProviderOutage(listener: OutageListener): void {
  outageListeners.push(listener);
}

function reportOutage(code: string): void {
  const provider =
    code === 'payments_unavailable' ? 'payments' : code === 'storage_unavailable' ? 'storage' : null;
  if (provider === null) return;
  for (const listener of outageListeners) listener(provider);
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const raw = await response.text();
  if (!response.ok) {
    const body = parseErrorBody(raw, response.status);
    reportOutage(body.error.code);
    throw new ApiFailure(response.status, body);
  }
  return JSON.parse(raw) as T;
}

function parseErrorBody(raw: string, status: number): ApiErrorBody {
  try {
    const parsed = JSON.parse(raw) as ApiErrorBody;
    if (typeof parsed.error?.code === 'string') return parsed;
  } catch {
    // The boundary answers HTML only for page routes, so fall through.
  }
  return { error: { code: 'unexpected', message: `Request failed with status ${status}` } };
}

export function renterHeaders(renterKey: string | null): Record<string, string> {
  return renterKey === null ? {} : { 'X-Renter-Key': renterKey };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function apiGet<T>(
  path: string,
  headers: Record<string, string> = {},
): Promise<T> {
  return unwrap<T>(await fetch(path, { headers, credentials: 'same-origin' }));
}

export async function apiSend<T>(
  method: 'POST' | 'DELETE',
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  return unwrap<T>(
    await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
      credentials: 'same-origin',
    }),
  );
}

export async function apiUpload<T>(
  path: string,
  form: FormData,
  headers: Record<string, string> = {},
): Promise<T> {
  return unwrap<T>(
    await fetch(path, { method: 'POST', headers, body: form, credentials: 'same-origin' }),
  );
}
