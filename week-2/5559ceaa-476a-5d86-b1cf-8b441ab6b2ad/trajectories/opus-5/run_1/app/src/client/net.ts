export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'RequestFailed';
  }

  field(name: string): string | undefined {
    const fields = this.extra['fields'];
    if (typeof fields !== 'object' || fields === null) return undefined;
    const value = (fields as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : undefined;
  }
}

interface Options {
  method?: string;
  body?: unknown;
  zip?: Blob;
  idempotencyKey?: string;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.zip !== undefined) {
    headers['content-type'] = 'application/zip';
    body = options.zip;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) {
    headers['idempotency-key'] = options.idempotencyKey;
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
  });

  const text = await response.text();
  const payload: unknown = text === '' ? null : safeParse(text);

  if (!response.ok) {
    const error =
      typeof payload === 'object' && payload !== null
        ? (payload as { error?: { code?: string } }).error
        : undefined;
    throw new RequestFailed(
      response.status,
      error?.code ?? 'internal',
      (error ?? {}) as Record<string, unknown>,
    );
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
