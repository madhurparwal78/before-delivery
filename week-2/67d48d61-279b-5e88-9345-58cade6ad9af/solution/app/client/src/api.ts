// Calls to the Promptside API. Every write names the crew member acting.

import type { ApiErrorBody } from "../../shared/catalog";

export interface ApiReply<T> {
  ok: boolean;
  status: number;
  body: T;
  error: ApiErrorBody["error"] | null;
}

export class Unreachable extends Error {}

let actingAs = "maya";

export const setActor = (handle: string): void => {
  actingAs = handle;
};

export const newKey = (): string =>
  typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const call = async <T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiReply<T>> => {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(method === "GET" ? {} : { "X-Crew-Member": actingAs }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Unreachable();
  }
  const parsed = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  return { ok: res.ok, status: res.status, body: parsed as T, error: res.ok ? null : (parsed?.error ?? { code: "unknown", message: "" }) };
};

export const get = async <T>(path: string): Promise<T> => {
  const reply = await call<T>("GET", path);
  if (!reply.ok) throw new Error(`${path} answered ${reply.status}`);
  return reply.body;
};

interface UploadHandlers {
  onProgress: (fraction: number) => void;
}

// Uploads go through XHR for progress events.
export const upload = (path: string, form: FormData, handlers: UploadHandlers): Promise<ApiReply<unknown>> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("X-Crew-Member", actingAs);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) handlers.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      const ok = xhr.status >= 200 && xhr.status < 300;
      resolve({ ok, status: xhr.status, body, error: ok ? null : ((body as ApiErrorBody | null)?.error ?? { code: "unknown", message: "" }) });
    };
    xhr.onerror = () => reject(new Unreachable());
    xhr.onabort = () => reject(new Unreachable());
    xhr.send(form);
  });
