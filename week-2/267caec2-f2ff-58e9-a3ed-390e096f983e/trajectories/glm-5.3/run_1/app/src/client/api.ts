export interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
  errors?: Record<string, string>;
}

export class ApiFailure extends Error implements ApiErrorShape {
  status: number;
  code: string;
  errors?: Record<string, string>;
  constructor(status: number, code: string, message: string, errors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export interface User {
  id: string;
  role: "director" | "juror" | "studio";
  name: string;
  email: string;
  studioId: string | null;
  studioName: string | null;
}

let session: User | null = null;
let sessionLoaded = false;
const listeners = new Set<(user: User | null) => void>();

export function currentUser(): User | null {
  return session;
}

export function hasSession(): boolean {
  return sessionLoaded;
}

export function onSession(fn: (user: User | null) => void): void {
  listeners.add(fn);
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

export async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiFailure(0, "network", "The desk can't be reached. Check your connection and try again.");
  }
  const data = await parse(response);
  if (!response.ok) {
    const shape = (data ?? {}) as { error?: string; message?: string; errors?: Record<string, string> };
    throw new ApiFailure(response.status, shape.error ?? "unknown", shape.message ?? "The desk can't be reached. Check your connection and try again.", shape.errors);
  }
  return data as T;
}

export function get<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  return request<T>("POST", path, body ?? {}, idempotencyKey);
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PUT", path, body ?? {});
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", path, body ?? {});
}

export function del<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}

export async function loadSession(): Promise<User | null> {
  sessionLoaded = true;
  try {
    const result = await get<{ user: User }>("/api/session");
    session = result.user;
  } catch {
    session = null;
  }
  for (const listener of listeners) {
    listener(session);
  }
  return session;
}

export function setSession(user: User | null): void {
  session = user;
  sessionLoaded = true;
  for (const listener of listeners) {
    listener(user);
  }
}

/** Uploads one file, reporting real progress through XHR. */
export function uploadFile<T>(path: string, file: File, onProgress: (loaded: number, total: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.total);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        const shape = (data ?? {}) as { error?: string; message?: string; errors?: Record<string, string> };
        reject(new ApiFailure(xhr.status, shape.error ?? "unknown", shape.message ?? "The desk can't be reached. Check your connection and try again.", shape.errors));
      }
    };
    xhr.onerror = () => reject(new ApiFailure(0, "network", "The desk can't be reached. Check your connection and try again."));
    xhr.send(form);
  });
}
