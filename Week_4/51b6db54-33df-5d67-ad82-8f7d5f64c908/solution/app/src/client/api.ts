export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T;
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: (text === '' ? {} : JSON.parse(text)) as T };
  } catch {
    return { ok: false, status: 0, body: {} as T };
  }
}

export async function upload<T = Record<string, unknown>>(path: string, file: File): Promise<ApiResult<T>> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
    return { ok: response.ok, status: response.status, body: (await response.json()) as T };
  } catch {
    return { ok: false, status: 0, body: {} as T };
  }
}

export interface Refusal {
  message: string;
  fields: Record<string, string>;
}

/** The text of a refusal: the message, or the first field error, exactly as the API sent it. */
export function refusal(result: ApiResult<unknown>): Refusal {
  const body = result.body as { message?: string; errors?: Record<string, string>; error?: string };
  const fields = body.errors ?? {};
  if (result.status === 0) return { message: 'You are offline', fields };
  if (result.status === 503 && body.error === 'storage_unavailable') return { message: STORAGE_DOWN, fields };
  return { message: body.message ?? Object.values(fields)[0] ?? 'Something went wrong. Try again.', fields };
}

export const STORAGE_DOWN = 'Storage is unavailable. Your artwork is safe.';
