import type { ErrorBody, ErrorCode } from '../shared/errors.ts';

/** An API error as the client sees it: the one published body shape. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string>;
  readonly lines: string[];

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.error;
    this.fields = body.fields ?? {};
    this.lines = body.lines ?? [];
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json();
  if (!response.ok) throw new HttpError(response.status, body as ErrorBody);
  return body as T;
}

/** Call the app's JSON API. A body that is a Uint8Array or Blob is sent raw. */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const raw = body instanceof Uint8Array || body instanceof Blob;
  const response = await fetch(path, {
    method,
    headers: body === undefined || raw ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  });
  return parse<T>(response);
}
