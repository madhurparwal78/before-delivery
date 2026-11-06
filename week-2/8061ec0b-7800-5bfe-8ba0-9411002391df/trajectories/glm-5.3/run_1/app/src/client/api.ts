// API client: one fetch wrapper, one error shape, and the estimate of the
// server clock built from server_now answers.

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    alternatives?: { instrument_type: string; size: string; available: number }[];
    quote?: Record<string, unknown>;
    photo_index?: number;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorShape
  ) {
    super(body.error.message);
  }
  get code(): string {
    return this.body.error.code;
  }
  get fields(): Record<string, string> | undefined {
    return this.body.error.fields;
  }
}

export async function api<T>(method: string, path: string, body?: unknown, options: { headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new Error("Couldn't reach Bellroll. Nothing was changed; check your connection and try again.");
    }
    return undefined as T;
  }
  const parsed = (await response.json()) as T | ApiErrorShape;
  if (!response.ok) {
    throw new ApiError(response.status, parsed as ApiErrorShape);
  }
  return parsed as T;
}

// The estimate of the server clock: server_now plus the time elapsed since
// that answer arrived, measured with the browser's elapsed-time counter,
// which a wrong or frozen device date does not affect.
class ServerClock {
  private anchorPerformance = 0;
  private anchorServerMs: number | null = null;
  private lastSync = 0;

  syncFrom(serverNow: string | undefined): void {
    if (!serverNow) return;
    const ms = Date.parse(serverNow);
    if (Number.isNaN(ms)) return;
    this.anchorServerMs = ms;
    this.anchorPerformance = performance.now();
    this.lastSync = performance.now();
  }

  // Ask the server again at least every 60 seconds while a time-sensitive
  // page is open.
  needsResync(): boolean {
    return performance.now() - this.lastSync > 55_000;
  }

  now(): Date | null {
    if (this.anchorServerMs === null) return null;
    return new Date(this.anchorServerMs + (performance.now() - this.anchorPerformance));
  }
}

export const serverClock = new ServerClock();
