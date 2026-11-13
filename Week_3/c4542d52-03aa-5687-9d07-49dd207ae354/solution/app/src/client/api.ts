import type { ApiErrorBody } from "../shared/types.js";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error.message);
  }
  get code(): string {
    return this.body.error.code;
  }
  get fields(): Record<string, string> {
    return this.body.fields ?? {};
  }
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json();
  if (!response.ok) throw new ApiFailure(response.status, payload as ApiErrorBody);
  return payload as T;
}

export async function documentText(id: string): Promise<string> {
  const response = await fetch(`/api/documents/${id}/content`);
  if (!response.ok) throw new ApiFailure(response.status, (await response.json()) as ApiErrorBody);
  return response.text();
}
