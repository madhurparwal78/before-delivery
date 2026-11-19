export class ApiFailure extends Error {
  readonly status: number;
  readonly field: string | null;
  readonly stepId: string | null;
  readonly step: unknown;

  constructor(status: number, message: string, field: string | null, stepId: string | null, step: unknown) {
    super(message);
    this.status = status;
    this.field = field;
    this.stepId = stepId;
    this.step = step;
  }
}

interface ErrorBody {
  error?: string;
  field?: string;
  step_id?: string;
  step?: unknown;
}

async function failure(response: Response): Promise<ApiFailure> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    body = {};
  }
  return new ApiFailure(
    response.status,
    body.error ?? 'Something went wrong',
    body.field ?? null,
    body.step_id ?? null,
    body.step,
  );
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiUpload(path: string, bytes: ArrayBuffer): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: bytes,
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as unknown;
}

export async function apiDownload(path: string): Promise<{ bytes: Blob; filename: string }> {
  const response = await fetch(path, { method: 'POST' });
  if (!response.ok) throw await failure(response);
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { bytes: await response.blob(), filename: match === null ? 'automation.json' : match[1] };
}
