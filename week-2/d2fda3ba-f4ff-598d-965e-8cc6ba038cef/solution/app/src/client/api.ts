// Same-origin JSON calls to the Cairn API.
import type { ApiErrorBody } from "../shared/types.ts";

/** The server answered with an error status. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody | null) {
    super(body?.error.message ?? `HTTP ${status}`);
  }

  get code(): string {
    return this.body?.error.code ?? "";
  }
}

/** The request never reached the server (offline or the server is down). */
export class NetworkError extends Error {}

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError("The network is unreachable.");
  }
  if (!response.ok) {
    let parsed: ApiErrorBody | null = null;
    try {
      parsed = await response.json() as ApiErrorBody;
    } catch {
      parsed = null;
    }
    throw new HttpError(response.status, parsed);
  }
  return response;
}

export async function api<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const response = await send(method, path, body, headers);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function apiBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await send("GET", path)).arrayBuffer());
}
