// The one client of the desk's API. Refusals come back as the published error body; a session that ended or a
// membership that was removed is announced once, with what the member typed kept for after sign-in.
import { feedback } from "./store";
import { saveDrafts } from "./drafts";
import { parseMoneyJson, stringifyMoneyJson } from "../shared/json";

export interface ApiFailure {
  code: string;
  message: string;
  fields: Record<string, string>;
}

export type Result<T> = { ok: true; status: number; data: T; response: Response } | { ok: false; status: number; error: ApiFailure };

interface Send {
  json?: unknown;
  body?: BodyInit;
  contentType?: string;
  /** A background refresh: its refusals never replace the message of the user's last action. */
  quiet?: boolean;
  /** A file download: a success body is left unread for the caller. */
  raw?: boolean;
}

const SESSION_CODES = ["session_ended", "access_removed"];

export async function api<T>(method: string, path: string, send: Send = {}): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined = send.body;
  if (send.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = stringifyMoneyJson(send.json);
  } else if (send.contentType) {
    headers["Content-Type"] = send.contentType;
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, error: { code: "offline", message: "The desk can't be reached. Check the connection and try again.", fields: {} } };
  }
  const type = response.headers.get("Content-Type") ?? "";
  if (response.ok) {
    const data = type.includes("application/json") && !send.raw ? (parseMoneyJson(await response.text()) as T) : (undefined as T);
    return { ok: true, status: response.status, data, response };
  }
  const parsed = type.includes("application/json") ? (parseMoneyJson(await response.text()) as { error?: ApiFailure }) : {};
  const error = parsed.error ?? { code: "unknown", message: `The desk answered ${response.status}.`, fields: {} };
  if (response.status === 401 && SESSION_CODES.includes(error.code) && !send.quiet) {
    if (error.code === "session_ended") saveDrafts();
    feedback.set({ action: "session", text: error.message, tone: "refusal", signIn: error.code === "session_ended" ? "again" : "only" });
  }
  return { ok: false, status: response.status, error };
}

export function sessionRefusal(error: ApiFailure): boolean {
  return SESSION_CODES.includes(error.code);
}
