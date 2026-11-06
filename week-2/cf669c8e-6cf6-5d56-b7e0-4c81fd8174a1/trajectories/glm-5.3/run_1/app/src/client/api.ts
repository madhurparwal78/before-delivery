// Client API wrapper: JSON in and out, the one failure shape.

export interface ApiFailure {
  status: number;
  error?: string;
  errors?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiFailure) {
    super(body.error ?? `HTTP ${status}`);
  }
}

export async function api<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (json ?? {}) as ApiFailure);
  }
  return json as T;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatLengthMm(mm: number, units: 'metric' | 'imperial'): string {
  if (units === 'imperial') return `${(mm / 25.4).toFixed(3)} in`;
  return `${(mm / 10).toFixed(1)} mm`;
}

export function formatMassKg(kg: number, units: 'metric' | 'imperial'): string {
  if (units === 'imperial') return `${(kg / 0.45359237).toFixed(1)} lb`;
  return `${kg.toFixed(1)} kg`;
}

export function formatStatusWord(word: string): string {
  return word;
}
