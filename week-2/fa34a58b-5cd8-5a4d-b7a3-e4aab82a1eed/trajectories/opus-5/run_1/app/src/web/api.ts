import type { ApiErrorBody } from '../shared/types';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> | undefined,
  ) {
    super(message);
  }
}

/** A request that never reached the hub, as opposed to one the hub refused. */
export class HubUnreachable extends Error {}

export const HUB_UNREACHABLE_COPY =
  "Nightplan can't reach the hub. Your last change was not saved.";

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new HubUnreachable(HUB_UNREACHABLE_COPY);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiFailure(
      response.status,
      payload?.error.code ?? 'not_found',
      payload?.error.message ?? 'Nothing here by that name.',
      payload?.fields,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>('POST', path, body, headers),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body),
};
