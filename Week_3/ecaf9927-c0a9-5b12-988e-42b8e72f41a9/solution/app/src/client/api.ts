import type { ApiErrorBody } from '../shared/api';

export type Failure = ApiErrorBody['error'] & { status: number };

export type Result<T> = { ok: true; data: T; status: number } | { ok: false; failure: Failure };

/** The server did not answer: the network failed or the request was aborted. */
export class NoAnswer extends Error {}

export const NO_ANSWER_COPY = 'No answer from the server. Your change was not confirmed.';

/** One JSON request against the app's own origin. Throws NoAnswer when no answer comes back. */
export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NoAnswer();
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  if (response.ok) return { ok: true, data: parsed as T, status: response.status };
  return { ok: false, failure: { ...(parsed as ApiErrorBody).error, status: response.status } };
}

export const get = <T,>(path: string) => call<T>('GET', path);

export const newKey = (): string => crypto.randomUUID();
