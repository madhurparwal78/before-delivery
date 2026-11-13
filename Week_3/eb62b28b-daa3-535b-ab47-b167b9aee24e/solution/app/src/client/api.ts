// Every request to the server, checked against the published shapes.

import type { z } from "zod";
import { ApiErrorBody } from "../shared/api";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

let lastServerDate: Date | null = null;
let onSessionEnded: () => void = () => undefined;

export function watchSessionEnd(handler: () => void): void {
  onSessionEnded = handler;
}

// The server's clock, from the Date header of its latest answer. The browser's clock is never read.
export function serverNow(): Date {
  return lastServerDate ?? new Date(0);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const answer = await fetch(path, { credentials: "same-origin", ...init });
  const date = answer.headers.get("Date");
  if (date) lastServerDate = new Date(date);
  if (answer.ok) return answer;
  const parsed = ApiErrorBody.safeParse(await answer.json().catch(() => null));
  const error = parsed.success ? parsed.data.error : { code: "unexpected", message: "Something went wrong. Please try again.", fields: {} };
  if (error.code === "session_ended") onSessionEnded();
  throw new ApiFailure(answer.status, error.code, error.message, error.fields ?? {});
}

export async function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  return schema.parse(await (await send(path, {})).json());
}

function jsonInit(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

export async function sendJson<S extends z.ZodType>(method: string, path: string, body: unknown, schema: S, headers?: Record<string, string>): Promise<z.output<S>> {
  return schema.parse(await (await send(path, jsonInit(method, body, headers))).json());
}

export async function sendNoAnswer(method: string, path: string, body?: unknown): Promise<void> {
  await send(path, body === undefined ? { method } : jsonInit(method, body));
}

export async function upload<S extends z.ZodType>(path: string, form: FormData, schema: S): Promise<z.output<S>> {
  return schema.parse(await (await send(path, { method: "POST", body: form })).json());
}

export async function download(path: string, fileName: string): Promise<void> {
  const answer = await send(path, {});
  const address = URL.createObjectURL(await answer.blob());
  const link = document.createElement("a");
  link.href = address;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(address);
}
