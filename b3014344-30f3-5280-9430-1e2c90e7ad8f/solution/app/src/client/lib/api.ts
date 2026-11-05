import type { ApiError, User } from "../../shared/domain";

/** The data the server writes into each page: its studio-clock reading, the user and the page state. */
interface Boot {
  now: string;
  user: User | null;
  page: "ok" | "not_found" | "access_ended";
}

export const boot: Boot = JSON.parse(document.getElementById("boot")?.textContent ?? "null") ?? {
  now: new Date().toISOString(),
  user: null,
  page: "ok",
};

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError & Record<string, unknown>,
  ) {
    super(body.message);
  }
  get code(): string {
    return this.body.error;
  }
}

/** JSON requests to the app's own API; any non-2xx answer becomes a RequestError with the error body. */
export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    throw new RequestError(0, { error: "network", message: "The connection dropped. Try again." });
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({ error: "unreadable", message: "Something went wrong. Try again." }));
  if (!response.ok) throw new RequestError(response.status, body);
  return body as T;
}

/** Uploads one file as multipart `file`, reporting progress from 0 to 100. */
export function upload<T>(path: string, file: File, progress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.floor((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = { error: "unreadable", message: "Something went wrong. Try again." };
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        progress(100);
        resolve(body as T);
      } else reject(new RequestError(xhr.status, body as ApiError & Record<string, unknown>));
    };
    xhr.onerror = () => reject(new RequestError(0, { error: "network", message: "The connection dropped. Try again." }));
    const form = new FormData();
    form.append("file", file, file.name);
    progress(0);
    xhr.send(form);
  });
}

/** Fetches a short-lived download link and hands the bytes to the browser as a download. */
export async function downloadLink(url: string, name: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new RequestError(0, { error: "network", message: "The connection dropped. Try again." });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unreadable", message: "Something went wrong. Try again." }));
    throw new RequestError(response.status, body);
  }
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export function newKey(): string {
  return crypto.randomUUID();
}
