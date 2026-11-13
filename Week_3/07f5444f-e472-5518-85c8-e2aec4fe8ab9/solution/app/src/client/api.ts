// Same-origin JSON calls to the API. Every answer is either the parsed body or the error shape.

import type { ApiErrorBody } from "../shared/api";

export type Answer<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody | null };

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value && "message" in value;
}

export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  if (response.status === 401 && path !== "/api/session") window.dispatchEvent(new Event("qw:signed-out"));
  return { ok: false, status: response.status, error: isErrorBody(parsed) ? parsed : null };
}

export const get = <T>(path: string): Promise<Answer<T>> => call<T>("GET", path);

/** A fresh idempotency key for one publish attempt. */
export function freshKey(): string {
  return crypto.randomUUID();
}

type UploadResult = { ok: true; status: number; data: unknown } | { ok: false; status: number };

/** Sends a scan as multipart/form-data under its own file name, reporting the bytes sent. */
export function uploadScan(partId: string, kind: string, file: File, onProgress: (fraction: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file, file.name);
    const request = new XMLHttpRequest();
    request.open("POST", `/api/parts/${encodeURIComponent(partId)}/scans`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        data = null;
      }
      resolve(request.status === 201 ? { ok: true, status: 201, data } : { ok: false, status: request.status });
    };
    request.onerror = () => resolve({ ok: false, status: 0 });
    request.onabort = () => resolve({ ok: false, status: 0 });
    request.send(form);
  });
}

/** The brief's reason copy for a failed upload, by status. */
export function uploadReason(status: number, fileSize: number): string {
  if (status === 503) return "the score store is offline";
  if (status === 415) return "only PDF, PNG or JPEG files can be filed";
  if (status === 413) return "the file is larger than 20,000,000 bytes";
  if (status === 422 && fileSize === 0) return "the file is empty";
  return "the upload did not finish";
}
