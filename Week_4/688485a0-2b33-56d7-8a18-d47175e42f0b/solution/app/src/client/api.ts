import type { JsonValue } from "../shared/json.js";
import type { ErrorBody } from "../shared/messages.js";

/** Every request goes to the same origin; a refusal surfaces as an ApiFailure carrying the published error body. */

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

async function request<T>(method: string, path: string, body?: JsonValue): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const parsed = (await response.json()) as ErrorBody | T;
  if (!response.ok) throw new ApiFailure(response.status, parsed as ErrorBody);
  return parsed as T;
}

export const get = <T,>(path: string): Promise<T> => request<T>("GET", path);
export const post = <T,>(path: string, body?: JsonValue): Promise<T> => request<T>("POST", path, body ?? {});
export const put = <T,>(path: string, body: JsonValue): Promise<T> => request<T>("PUT", path, body);
export const patch = <T,>(path: string, body: JsonValue): Promise<T> => request<T>("PATCH", path, body);
export const del = (path: string): Promise<void> => request<void>("DELETE", path);

export const asFailure = (error: unknown): ApiFailure => (error instanceof ApiFailure ? error : new ApiFailure(0, { error: "network" }));

export interface UserInfo {
  id: string;
  email: string;
  name: string;
}

export type Role = "owner" | "editor" | "reader";

export interface CollectionSummary {
  id: string;
  name: string;
  count: number;
}

export interface CollectionInfo extends CollectionSummary {
  sequence: number;
  validator: JsonValue;
}

export interface ProjectInfo {
  id: string;
  name: string;
  role: Role;
  owner: { email: string; name: string };
}
