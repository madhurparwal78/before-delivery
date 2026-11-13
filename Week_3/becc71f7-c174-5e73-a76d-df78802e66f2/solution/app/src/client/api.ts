// Talks to the server, keeps its clock, and reports an ended session wherever it is noticed.
import type { ErrorBody } from "../shared/api";
import { announceSessionEnded } from "./state";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

let serverNow: Date | null = null;

/** The server's time at its latest answer; the device clock is never read for dates. */
export const serverClock = (): Date | null => serverNow;

interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Leave an ended session unannounced, as when a page first checks who is signed in. */
  quiet?: boolean;
}

const OFFLINE_MESSAGE = "The shop can't be reached right now. Try again in a moment.";

export async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = "GET", json, body, headers = {}, quiet = false } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: json === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      ...(json === undefined ? (body === undefined ? {} : { body }) : { body: JSON.stringify(json) }),
    });
  } catch {
    throw new ApiFailure(0, "offline", OFFLINE_MESSAGE);
  }
  const date = response.headers.get("date");
  if (date) serverNow = new Date(date);
  if (response.ok) return response;
  const failure = ((await response.json()) as ErrorBody).error;
  if (failure.code === "session_ended" && !quiet) announceSessionEnded();
  throw new ApiFailure(response.status, failure.code, failure.message, failure.fields);
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await (await request(path, options)).json()) as T;
}
