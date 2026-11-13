// The browser's only way to the server: same-origin JSON requests with typed results.
import type { ApiError, PhotoUpload } from "../shared/api";

type Result<T> =
  | { ok: true; status: number; data: T; date: Date | null }
  | { ok: false; status: number; error: ApiError | null; network: boolean };

export async function request<T>(method: string, path: string, body?: unknown, key?: string): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: null, network: true };
  }
  return settle<T>(response);
}

async function settle<T>(response: Response): Promise<Result<T>> {
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (response.ok) {
    const header = response.headers.get("date");
    return { ok: true, status: response.status, data: json as T, date: header ? new Date(header) : null };
  }
  const error = json && typeof json === "object" && "error" in json ? (json as ApiError) : null;
  return { ok: false, status: response.status, error, network: response.status >= 500 && error === null };
}

const HEIC = /\.(heic|heif)$/i;

/** Uploads a photo exactly as chosen; a HEIC file the browser left untyped is sent as image/heic. */
export async function uploadPhoto(file: File): Promise<Result<PhotoUpload>> {
  const typed = !file.type && HEIC.test(file.name) ? new File([file], file.name, { type: "image/heic" }) : file;
  const form = new FormData();
  form.append("photo", typed, file.name);
  try {
    return settle<PhotoUpload>(await fetch("/api/photos", { method: "POST", body: form, credentials: "same-origin" }));
  } catch {
    return { ok: false, status: 0, error: null, network: true };
  }
}
