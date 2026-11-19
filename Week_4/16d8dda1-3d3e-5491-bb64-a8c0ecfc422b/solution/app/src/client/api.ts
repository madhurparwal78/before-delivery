export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const OFFLINE = 'Slatehall could not be reached. Check your connection and try again.';

async function send(method: string, path: string, body: BodyInit | undefined, headers: Record<string, string>): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { method, body, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (response.ok) return response;
  let message = OFFLINE;
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') message = parsed.error;
  } catch {
    message = `Request failed (${response.status}).`;
  }
  throw new ApiError(response.status, message);
}

/** JSON request; the answer is parsed as T (callers name the wire type). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? {} : { 'Content-Type': 'application/json' });
  return (await response.json()) as T;
}

/** JSON request whose answer has no body (204). */
export async function apiNoContent(method: string, path: string, body?: unknown): Promise<void> {
  await send(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? {} : { 'Content-Type': 'application/json' });
}

/** multipart upload; the answer is parsed as T. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await send('POST', path, form, {});
  return (await response.json()) as T;
}
