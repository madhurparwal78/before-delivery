// JSON calls to the same-origin API, with the server's error shape turned into ApiFailure.

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly state: string | null;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}, state: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.state = state;
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; fields?: unknown; state?: unknown };
}

function readFields(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, "network", "The connection failed.");
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as ErrorBody | null)?.error;
    throw new ApiFailure(
      response.status,
      typeof error?.code === "string" ? error.code : "unknown",
      typeof error?.message === "string" ? error.message : "",
      readFields(error?.fields),
      typeof error?.state === "string" ? error.state : null,
    );
  }
  return payload as T;
}

export const get = <T>(path: string): Promise<T> => api<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}): Promise<T> => api<T>("POST", path, body);
export const remove = <T>(path: string): Promise<T> => api<T>("DELETE", path);
