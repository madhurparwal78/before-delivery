import { viewer } from "./viewer";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(`${status} ${code}`);
  }
}

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Sends a JSON request and returns the status and body whatever they are; a lost connection rejects. */
export async function exchange(method: string, path: string, body?: unknown | string): Promise<Answer> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed: unknown = text === "" ? {} : JSON.parse(text);
  const answer = { status: response.status, body: (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown> };
  if (answer.status === 401 && answer.body.error === "unauthenticated") viewer.sessionEnded();
  return answer;
}

/** Like `exchange`, but a status of 400 or more throws an ApiError carrying the server's code. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const answer = await exchange(method, path, body);
  if (answer.status >= 400) throw new ApiError(answer.status, String(answer.body.error ?? "error"), answer.body);
  return answer.body as T;
}
