import { copy } from '../../shared/copy.js';
import type { ApiErrorBody } from '../../shared/wire.js';

/** An answer from the API that is not a success, in the one published error shape (code NETWORK: the request never arrived). */
class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly holder?: string | null,
  ) {
    super(message);
  }
}

/** `request` only ever throws an ApiFailure: the API's answer, or NETWORK when nothing arrived. */
export const failureOf = (error: unknown): ApiFailure => error as ApiFailure;

type Json = Record<string, unknown> | unknown[] | null;

export const request = async <T,>(method: string, path: string, body?: Json | FormData, headers: Record<string, string> = {}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined || body instanceof FormData ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiFailure('NETWORK', copy.notSaved);
  }
  if (response.status === 204) return undefined as T;
  const parsed = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const error = (parsed as ApiErrorBody | null)?.error;
    throw new ApiFailure(error?.code ?? 'INTERNAL', error?.message ?? copy.internal, error?.fields, error?.holder);
  }
  return parsed as T;
};

export const get = <T,>(path: string): Promise<T> => request<T>('GET', path);
export const post = <T,>(path: string, body?: Json, headers?: Record<string, string>): Promise<T> => request<T>('POST', path, body ?? {}, headers);
