import { copy } from '../../shared/copy';
import type { ApiErrorBody } from '../../shared/types';

export type Failure = ApiErrorBody['error'] & { status: number };
type Result<T> = { ok: true; data: T } | { ok: false; failure: Failure };

const offline: Failure = { status: 0, code: 'network', message: copy.saveFailed };

async function settle<T>(response: Response): Promise<Result<T>> {
  const text = await response.text();
  const data: unknown = text === '' ? undefined : JSON.parse(text);
  if (response.ok) {
    return { ok: true, data: data as T };
  }
  const error = (data as Partial<ApiErrorBody> | undefined)?.error;
  return { ok: false, failure: { ...(error ?? { code: 'internal_error', message: copy.saveFailed }), status: response.status } };
}

/** Call the JSON API. A failure is a value, never an exception. */
export async function api<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  try {
    return await settle<T>(
      await fetch(url, {
        method,
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  } catch {
    return { ok: false, failure: offline };
  }
}

/** Send a file as the raw request body. */
export async function upload<T = unknown>(url: string, file: File | Blob, contentType: string): Promise<Result<T>> {
  try {
    return await settle<T>(await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body: file }));
  } catch {
    return { ok: false, failure: offline };
  }
}
