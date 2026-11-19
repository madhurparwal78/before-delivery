// Every request goes through here: answers that arrive after Sign out are dropped, and an ended
// session hands control to the session-ended handler instead of showing an error.

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.code ?? status));
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return typeof this.body.code === "string" ? this.body.code : "";
  }
}

let epoch = 0;
let sessionEnded: () => void = () => undefined;

/** Called on Sign out: any answer to a request sent earlier is ignored when it arrives. */
export function discardInFlight(): void {
  epoch += 1;
}

export function onSessionEnded(handler: () => void): void {
  sessionEnded = handler;
}

const NEVER = new Promise<never>(() => undefined);

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const sentIn = epoch;
  const response = await fetch(path, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (sentIn !== epoch) return NEVER;
  if (response.status === 401 && path !== "/api/session") {
    const answer: unknown = await response.clone().json().catch(() => ({}));
    if (typeof answer === "object" && answer !== null && "code" in answer && answer.code === "unauthenticated") {
      sessionEnded();
      return NEVER;
    }
  }
  return response;
}

async function failure(response: Response): Promise<ApiFailure> {
  const body: unknown = await response.json().catch(() => ({}));
  return new ApiFailure(response.status, typeof body === "object" && body !== null ? { ...body } : {});
}

export async function api<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const response = await send(method, path, body, headers);
  if (!response.ok) throw await failure(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function apiText(method: string, path: string, body?: unknown): Promise<string> {
  const response = await send(method, path, body);
  if (!response.ok) throw await failure(response);
  return response.text();
}

export async function apiBlob(path: string): Promise<Blob> {
  const response = await send("GET", path);
  if (!response.ok) throw await failure(response);
  return response.blob();
}

/** A fresh request key: 36 letters, digits and hyphens (works outside secure contexts too). */
export function newRequestKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
