// The browser's API client. It also keeps the server-time estimate: the Date header of the
// latest API response plus the time elapsed on this browser since it arrived.

type ApiErrorBody = {
  error: string;
  message: string;
  errors?: Record<string, string>;
  current?: { version: number; text: string; edited_by: { id: string; name: string }; edited_at: string };
};

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// The API's message copy for a failure, or the internal-error copy when there was no answer body.
export function apiMessage(failure: unknown): string {
  return failure instanceof ApiFailure && failure.body ? failure.body.message : "Something went wrong on our side. Try again.";
}

let anchor: { serverMs: number; elapsedAt: number } | null = null;

export function noteServerDate(header: string | null): void {
  const serverMs = header ? Date.parse(header) : Number.NaN;
  if (!Number.isNaN(serverMs)) anchor = { serverMs, elapsedAt: performance.now() };
}

export function serverNow(): number {
  return anchor ? anchor.serverMs + (performance.now() - anchor.elapsedAt) : Number.NaN;
}

let onSessionEnded: () => void = () => undefined;
export function whenSessionEnds(handler: () => void): void {
  onSessionEnded = handler;
}

async function read(response: Response): Promise<unknown> {
  noteServerDate(response.headers.get("date"));
  const type = response.headers.get("content-type") ?? "";
  const body: unknown = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const failure = new ApiFailure(response.status, body as ApiErrorBody | null);
    if (response.status === 401 && failure.body?.error === "unauthenticated") onSessionEnded();
    throw failure;
  }
  return body;
}

export async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  return (await read(response)) as T;
}

// Multipart upload through XHR so the progress bar follows the bytes actually sent.
export function upload<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      noteServerDate(xhr.getResponseHeader("date"));
      let parsed: unknown = null;
      if ((xhr.getResponseHeader("content-type") ?? "").includes("application/json")) {
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          parsed = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ status: xhr.status, body: parsed as T });
      else {
        if (xhr.status === 401) onSessionEnded();
        reject(new ApiFailure(xhr.status, parsed as ApiErrorBody | null));
      }
    };
    xhr.onerror = () => reject(new ApiFailure(0, null));
    xhr.send(form);
  });
}
