import { SERVER_UNREACHABLE } from "../../shared/copy.ts";

interface ErrorBody {
  error?: string;
  errors?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.error ?? Object.values(body.errors ?? {})[0] ?? `Request failed (${status}).`);
    this.status = status;
    this.body = body;
  }
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: SERVER_UNREACHABLE });
  }
}

async function failure(response: Response): Promise<ApiError> {
  const text = await response.text();
  const body: ErrorBody = text ? JSON.parse(text) : {};
  return new ApiError(response.status, body);
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body);
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getJson<T>(path: string): Promise<T> {
  return api<T>("GET", path);
}

export function withQuery(path: string, params: Record<string, string | number | boolean>): string {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  return `${path}?${query.toString()}`;
}

/** Fetches the square snapshot and hands it to the browser as a file download. */
export async function downloadSnapshot(workspaceId: string, height: number): Promise<void> {
  const response = await send("GET", `/api/w/${workspaceId}/blocks/${height}/snapshot`);
  if (!response.ok) throw await failure(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `block-${height}-square.bin`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
