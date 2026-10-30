export interface ApiEnvelope {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error?: string;
  errors?: Record<string, string>;
  message?: string;
  extra: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const options: RequestInit = {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    credentials: "same-origin",
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError(0, "network", "Network request failed.", {});
  }
  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    const code = typeof data.error === "string" ? data.error : "unknown";
    const message = typeof data.message === "string" ? data.message : "Request failed.";
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key !== "error" && key !== "message") {
        extra[key] = value;
      }
    }
    throw new ApiError(response.status, code, message, extra);
  }
  return data as T;
}

export function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Something went wrong.";
}
