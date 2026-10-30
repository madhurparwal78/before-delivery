// The one fetch wrapper: same-origin JSON, the shared error body, and the server clock.
import { useEffect, useState } from "preact/hooks";
import type { ApiErrorBody } from "../shared/api";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

let serverOffsetMs = 0;

/** The server's clock as best known from the Date header of the latest response. */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

function noteServerTime(response: Response): void {
  const header = response.headers.get("date");
  const at = header ? Date.parse(header) : Number.NaN;
  if (Number.isFinite(at)) serverOffsetMs = at - Date.now();
}

async function failureOf(response: Response): Promise<ApiFailure> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiFailure(response.status, body.error.code, body.error.message, body.error.details ?? {});
  } catch {
    return new ApiFailure(response.status, "unknown", "", {});
  }
}

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiFailure(0, "network", "", {});
  }
  noteServerTime(response);
  if (!response.ok) throw await failureOf(response);
  return response;
}

export async function api<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  return (await response.json()) as T;
}

/** For 204 answers. */
export async function apiNoContent(method: string, path: string): Promise<void> {
  await send(method, path, {});
}

/** Fetches a file and hands it to the browser as a download. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const response = await send("GET", path, {});
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]*)"/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = match?.[1] || fallbackName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 128 random bits as hex; getRandomValues also works on plain-HTTP origins, unlike randomUUID. */
export function newIdempotencyKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Re-renders every `everyMs` and returns the server-clock instant. */
export function useServerNow(everyMs = 1000): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
