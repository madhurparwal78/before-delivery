export interface ApiBody {
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  lines?: string[];
  [key: string]: unknown;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiBody,
  ) {
    super(body.message ?? body.error ?? `Request failed (${status})`);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as ApiBody;
  if (!response.ok) {
    if (response.status === 401 && data.error === 'unauthenticated') {
      const next = location.pathname;
      location.assign(`/signin?next=${encodeURIComponent(next)}`);
    }
    throw new ApiFailure(response.status, data);
  }
  return data as T;
}

export async function apiRaw(method: string, path: string, body?: BodyInit): Promise<Response> {
  return fetch(path, { method, credentials: 'same-origin', body });
}

export function failureText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.body.message) return error.body.message;
    if (error.body.errors) return Object.values(error.body.errors).join(' ');
    return error.message;
  }
  return 'Runup Bay cannot be reached. Try again shortly.';
}

export function fieldErrorsOf(error: unknown): Record<string, string> | null {
  return error instanceof ApiFailure && error.body.errors ? error.body.errors : null;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  reduceMotion: boolean;
  school: { id: string; name: string } | null;
  classes: { id: string; name: string }[];
}

export function saveFile(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
