/** An API answer that was not 2xx, in the one error shape of the API. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly error: string;
  readonly errors: Record<string, string>;
  readonly lines: string[];

  constructor(status: number, body: { error?: string; message?: string; errors?: Record<string, string>; lines?: string[] }) {
    super(body.message ?? body.error ?? `Request failed (${status})`);
    this.status = status;
    this.error = body.error ?? "";
    this.errors = body.errors ?? {};
    this.lines = body.lines ?? [];
  }
}

interface RequestOptions {
  body?: unknown;
  raw?: BodyInit;
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  const hasJson = options.body !== undefined;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: hasJson ? { "Content-Type": "application/json" } : {},
    body: hasJson ? JSON.stringify(options.body) : options.raw,
  });
  if (!response.ok) {
    const text = await response.text();
    let body: ConstructorParameters<typeof ApiFailure>[1] = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      body = {};
    }
    throw new ApiFailure(response.status, body);
  }
  return response;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, { body });
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function apiRaw(method: string, path: string, raw: BodyInit): Promise<unknown> {
  const response = await send(method, path, { raw });
  return response.json();
}

export async function apiBlob(path: string): Promise<{ blob: Blob; headers: Headers }> {
  const response = await send("GET", path, {});
  return { blob: await response.blob(), headers: response.headers };
}
