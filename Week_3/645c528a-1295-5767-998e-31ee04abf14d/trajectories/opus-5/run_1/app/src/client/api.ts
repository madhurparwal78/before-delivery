export interface ApiFailure {
  status: number;
  error: string;
  message: string;
  errors?: Record<string, string>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const failure = parsed as ApiFailure | null;
      return {
        ok: false,
        failure: {
          status: response.status,
          error: failure?.error ?? 'server_error',
          message: failure?.message ?? '',
          errors: failure?.errors,
        },
      };
    }
    return { ok: true, data: parsed as T };
  } catch {
    return { ok: false, failure: { status: 0, error: 'offline', message: '' } };
  }
}
