interface ProblemBody {
  readonly code: string;
  readonly detail: string;
  readonly status: number;
  readonly errors?: Record<string, string>;
}

export class ApiProblem extends Error {
  readonly body: ProblemBody;

  constructor(body: ProblemBody) {
    super(body.detail);
    this.body = body;
  }
}

export function newKey(): string {
  return crypto.randomUUID();
}

interface CallOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly key?: string;
  readonly ifMatch?: string;
}

async function exchange<T>(path: string, options: CallOptions): Promise<{ body: T; etag: string | null }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.key !== undefined) headers['Idempotency-Key'] = options.key;
  if (options.ifMatch !== undefined) headers['If-Match'] = options.ifMatch;
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text === '' ? {} : (JSON.parse(text) as unknown);
  if (!response.ok) throw new ApiProblem(payload as ProblemBody);
  return { body: payload as T, etag: response.headers.get('etag') };
}

export async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  return (await exchange<T>(path, options)).body;
}

export function callWithTag<T>(path: string, options: CallOptions = {}): Promise<{ body: T; etag: string | null }> {
  return exchange<T>(path, options);
}
