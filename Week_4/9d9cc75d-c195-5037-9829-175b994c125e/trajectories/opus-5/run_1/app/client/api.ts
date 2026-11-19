let pending = 0;

function setPending(value: number): void {
  pending = value;
  document.body.dataset.pending = String(pending);
}

export interface ApiReply<T> {
  status: number;
  data: T;
}

export interface ApiErrorBody {
  error: string;
  errors?: Record<string, string> | { line: number | null; message: string }[];
  message?: string;
  version?: number;
  retry_after?: number;
  columns?: unknown[];
  rows?: unknown[];
  row_count?: number;
}

async function request<T>(method: string, path: string, init: RequestInit): Promise<ApiReply<T>> {
  setPending(pending + 1);
  try {
    const res = await fetch(path, { ...init, method, credentials: 'same-origin' });
    const text = await res.text();
    let data: unknown = null;
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, data: data as T };
  } catch {
    return { status: 0, data: { error: 'network' } as T };
  } finally {
    setPending(pending - 1);
  }
}

export function get<T>(path: string): Promise<ApiReply<T>> {
  return request<T>('GET', path, {});
}

export function send<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiReply<T>> {
  return request<T>(method, path, {
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function sendCsv<T>(method: string, path: string, body: string | ArrayBuffer): Promise<ApiReply<T>> {
  return request<T>(method, path, { headers: { 'content-type': 'text/csv' }, body });
}

export function retryAfterOf(res: ApiReply<ApiErrorBody>): number {
  return typeof res.data?.retry_after === 'number' ? res.data.retry_after : 1;
}

export function fieldErrors(data: ApiErrorBody | null): Record<string, string> {
  if (data === null || data.errors === undefined || Array.isArray(data.errors)) return {};
  return data.errors;
}

export function uploadErrors(data: ApiErrorBody | null): { line: number | null; message: string }[] {
  if (data === null || data.errors === undefined || !Array.isArray(data.errors)) return [];
  return data.errors;
}

export function generalMessage(res: ApiReply<ApiErrorBody>): string | null {
  if (res.status === 429) return `Too many requests. Try again in ${retryAfterOf(res)} seconds.`;
  if (res.status >= 500 || res.status === 0) return 'Something went wrong. Try again.';
  if (res.status === 403) return 'You do not have access to this.';
  return null;
}
