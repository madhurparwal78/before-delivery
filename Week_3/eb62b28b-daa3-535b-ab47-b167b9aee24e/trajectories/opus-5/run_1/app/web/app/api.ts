export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export interface ApiResult<T> {
  status: number;
  data: T | null;
  error: ApiErrorBody | null;
  retryAfter: number | null;
}

export const SESSION_ENDED = 'ocotillo:session-ended';

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  json?: unknown;
  form?: FormData;
  requestKey?: string;
}

export async function api<T>(path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: string | FormData | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  if (options.requestKey) headers['Request-Key'] = options.requestKey;
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
  });
  const retryAfterHeader = response.headers.get('Retry-After');
  const retryAfter = retryAfterHeader === null ? null : Number(retryAfterHeader);
  if (response.status === 204) {
    return { status: 204, data: null, error: null, retryAfter };
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return { status: response.status, data: null, error: null, retryAfter };
  }
  const payload = (await response.json()) as { error?: ApiErrorBody } & T;
  if (response.status >= 400) {
    const error = payload.error ?? { code: 'server_error', message: 'Something went wrong here.' };
    if (response.status === 401 && error.code === 'session_ended') {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED));
    }
    return { status: response.status, data: null, error, retryAfter };
  }
  return { status: response.status, data: payload, error: null, retryAfter };
}

export function startDownload(path: string): void {
  const link = document.createElement('a');
  link.href = path;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
