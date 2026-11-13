import type { ErrorBody } from "../shared/api-types";

/** The request got no response at all. */
export class Unreachable extends Error {}

export interface Reply<T> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

let onSignedOut: () => void = () => undefined;
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

interface Options {
  json?: unknown;
  file?: File;
  headers?: Record<string, string>;
  /** A 401 is an answer here, not the end of the desk session. */
  answers401?: boolean;
}

export async function request<T>(method: string, path: string, options: Options = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.file !== undefined) {
    headers["Content-Type"] = options.file.type;
    body = options.file;
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new Unreachable();
  }
  const text = await response.text();
  const data = (text === "" ? null : JSON.parse(text)) as T;
  if (response.status === 401 && options.answers401 !== true) onSignedOut();
  return { status: response.status, ok: response.ok, data, headers: response.headers };
}

export const get = <T>(path: string, options?: Options) => request<T>("GET", path, options);
export const post = <T>(path: string, json?: unknown, options?: Options) =>
  request<T>("POST", path, json === undefined ? options : { ...options, json });
export const put = <T>(path: string, json: unknown) => request<T>("PUT", path, { json });
export const patch = <T>(path: string, json: unknown) => request<T>("PATCH", path, { json });

export function errorCode(reply: Reply<unknown>): string {
  return (reply.data as ErrorBody | null)?.error ?? "";
}

export function fieldError(reply: Reply<unknown>, field: string): string | undefined {
  return (reply.data as ErrorBody | null)?.fields?.[field];
}
