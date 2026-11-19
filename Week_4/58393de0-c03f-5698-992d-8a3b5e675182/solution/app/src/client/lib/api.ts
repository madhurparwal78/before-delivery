import type { ErrorBody } from "../../shared/types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.error;
    this.fields = body.fields ?? {};
    this.body = body;
  }
}

const NETWORK_DOWN: ErrorBody = { error: "network", message: "We couldn't reach Quarkyard. Check your connection and try again." };

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : undefined;
}

async function request(method: string, path: string, body?: BodyInit | null, headers?: Record<string, string>): Promise<Response> {
  try {
    return await fetch(path, { method, body, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, NETWORK_DOWN);
  }
}

async function send<T>(method: string, path: string, body?: BodyInit | null, headers?: Record<string, string>): Promise<T> {
  const response = await request(method, path, body, headers);
  const payload = await parse(response);
  if (!response.ok) throw new ApiError(response.status, payload as ErrorBody);
  return payload as T;
}

function json<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return send<T>(method, path, body === undefined ? undefined : JSON.stringify(body), {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...headers,
  });
}

export const api = {
  get: <T>(path: string) => json<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => json<T>("POST", path, body, headers),
  put: <T>(path: string, body: unknown, headers?: Record<string, string>) => json<T>("PUT", path, body, headers),
  patch: <T>(path: string, body: unknown) => json<T>("PATCH", path, body),
  delete: <T = void>(path: string) => json<T>("DELETE", path),
  upload: <T>(path: string, bytes: Uint8Array) =>
    send<T>("POST", path, bytes.slice(), { "Content-Type": "application/octet-stream" }),
  download: async (path: string): Promise<Blob> => {
    const response = await request("GET", path);
    if (!response.ok) throw new ApiError(response.status, (await parse(response)) as ErrorBody);
    return response.blob();
  },
};
