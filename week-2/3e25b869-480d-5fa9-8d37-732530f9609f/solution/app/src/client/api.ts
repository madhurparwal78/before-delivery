// Same-origin JSON calls with the published error shape.
interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

/** A failed call; status 0 means the shop could not be reached (error.code `network`). */
export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, status: 0, error: { code: 'network', message: '' } };
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return { ok: false, status: response.status, error: (parsed as { error: ApiErrorBody }).error };
}

/** A fresh Idempotency-Key for one submission. */
export const newKey = () => `pdl-${crypto.randomUUID()}`;

export const etagHeader = (version: number) => ({ 'If-Match': `"${version}"` });
