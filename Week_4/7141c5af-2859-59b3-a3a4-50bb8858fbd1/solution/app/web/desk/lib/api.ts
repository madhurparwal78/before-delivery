import { copy } from "../../../server/domain/copy.ts";

/** A refusal from the API in its one published shape. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Listener = () => void;
const endedListeners = new Set<Listener>();
let ended = false;

export function sessionHasEnded(): boolean {
  return ended;
}

export function onSessionEnded(listener: Listener): () => void {
  endedListeners.add(listener);
  return () => void endedListeners.delete(listener);
}

function markEnded(): void {
  if (ended) return;
  ended = true;
  for (const listener of endedListeners) listener();
}

async function failureOf(response: Response): Promise<ApiFailure> {
  const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string; fields?: Record<string, string> } } | null;
  const error = body?.error;
  return new ApiFailure(response.status, error?.code ?? "unknown", error?.message ?? copy("F-02"), error?.fields);
}

/** One call to the published API. Any refusal throws ApiFailure; an ended session also raises the session-ended state. */
export async function send(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<Response> {
  const isForm = body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    method,
    credentials: "same-origin",
    ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
    ...(body === undefined || isForm ? {} : { headers: { "Content-Type": "application/json" } }),
  });
  if (response.ok) return response;
  const failure = await failureOf(response);
  if (response.status === 401) markEnded();
  throw failure;
}

export async function api<Result>(method: string, path: string, body?: unknown): Promise<Result> {
  const response = await send(method, path, body);
  return (response.status === 204 ? undefined : await response.json()) as Result;
}

export const get = <Result,>(path: string): Promise<Result> => api<Result>("GET", path);
export const post = <Result,>(path: string, body: unknown = {}): Promise<Result> => api<Result>("POST", path, body);
