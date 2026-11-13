import type { ErrorCode, PromotionState } from '../shared/types.js';

export interface ApiFailure {
  code: ErrorCode | 'network';
  message: string;
  status: number;
  fields?: Record<string, string>;
  holder?: {
    promotion_id: string;
    bundle_version: string;
    bundle_digest: string;
    state: PromotionState;
  };
  state?: PromotionState;
  current_version?: number;
}

export class ApiCallFailed extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

export interface Download {
  bytes: Blob;
  fileName: string;
}

function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = disposition ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

async function failureFrom(response: Response): Promise<ApiFailure> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return {
    code: (body.error as ErrorCode) ?? 'network',
    message: typeof body.message === 'string' ? body.message : 'Something went wrong.',
    status: response.status,
    fields: body.fields as Record<string, string> | undefined,
    holder: body.holder as ApiFailure['holder'],
    state: body.state as PromotionState | undefined,
    current_version: body.current_version as number | undefined,
  };
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  requestKey?: string;
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
  if (options.requestKey) headers['request-key'] = options.requestKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new ApiCallFailed({ code: 'network', message: String(cause), status: 0 });
  }
  if (!response.ok) throw new ApiCallFailed(await failureFrom(response));
  return response;
}

export async function get<Result>(path: string): Promise<Result> {
  return (await call(path)).json() as Promise<Result>;
}

export async function send<Result>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  requestKey?: string,
): Promise<Result> {
  const response = await call(path, { method, body: body ?? {}, requestKey });
  if (response.status === 204) return undefined as Result;
  return response.json() as Promise<Result>;
}

export async function download(path: string, fallbackName: string): Promise<Download> {
  const response = await call(path);
  return {
    bytes: await response.blob(),
    fileName: fileNameFrom(response.headers.get('content-disposition'), fallbackName),
  };
}

/** One request key per submission, reused by every retry of that same submission. */
export function newRequestKey(): string {
  return crypto.randomUUID();
}
