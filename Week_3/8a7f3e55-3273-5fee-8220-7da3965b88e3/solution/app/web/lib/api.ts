import type { ApiErrorBody, SessionUser } from "../../shared/api";
import { awaitSignIn } from "./session";

/** A failed call: `body` is null when the server could not be reached at all. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? "network");
  }

  get code(): string {
    return this.body?.error ?? "network";
  }
}

function isUnauthenticated(text: string): boolean {
  try {
    return (JSON.parse(text) as ApiErrorBody).error === "unauthenticated";
  } catch {
    return false;
  }
}

interface SendInit {
  body?: BodyInit;
  json?: unknown;
  idempotent?: boolean;
  key?: string;
  /** A user action: an `unauthenticated` answer waits for a new sign-in, then the identical request is resent once. */
  resumable?: boolean;
}

async function send<T>(method: string, path: string, init: SendInit): Promise<T> {
  const headers: Record<string, string> = {};
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  if (init.idempotent) headers["idempotency-key"] = init.key ?? crypto.randomUUID();
  const attempt = async (): Promise<{ response: Response; text: string }> => {
    try {
      const response = await fetch(path, { method, headers, body, credentials: "same-origin" });
      return { response, text: response.status === 204 ? "" : await response.text() };
    } catch {
      throw new ApiFailure(0, null);
    }
  };
  let answer = await attempt();
  if (init.resumable && answer.response.status === 401 && isUnauthenticated(answer.text)) {
    // Signing out from Sign in to continue drops the action: nothing is left to answer, so this never settles.
    if (!(await awaitSignIn())) return new Promise<never>(() => undefined);
    answer = await attempt();
  }
  if (answer.response.status === 204) return undefined as T;
  const parsed: unknown = answer.text === "" ? null : JSON.parse(answer.text);
  if (!answer.response.ok) throw new ApiFailure(answer.response.status, parsed as ApiErrorBody);
  return parsed as T;
}

export const apiGet = <T>(path: string): Promise<T> => send<T>("GET", path, {});

/** A state-changing call; each user action carries its own Idempotency-Key unless the caller keeps one for a draft. */
export const apiPost = <T>(path: string, json?: unknown, key?: string): Promise<T> => send<T>("POST", path, { json, idempotent: true, key, resumable: true });

/** Signing in is not a resumable action: it is what resuming waits for. */
export const apiSignIn = (email: string, password: string): Promise<{ user: SessionUser }> => send("POST", "/api/session", { json: { email, password } });

export const apiDelete = (path: string): Promise<void> => send<void>("DELETE", path, {});

export function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return send<T>("POST", path, { body: form, resumable: true });
}

/** The prep file behind a freshly issued download link. */
export async function fetchFile(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ApiFailure(0, null);
  }
  if (!response.ok) throw new ApiFailure(response.status, (await response.json()) as ApiErrorBody);
  return response.blob();
}
