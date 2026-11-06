/** The one API client the screens use. */

export interface ApiFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly retryAfter: number | null;
}

export class RequestFailed extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

async function toFailure(response: Response): Promise<ApiFailure> {
  let code = 'server_error';
  let message = 'Not found.';
  let fields: Record<string, string> = {};
  try {
    const body = (await response.json()) as ErrorBody;
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    fields = body.error?.fields ?? {};
  } catch {
    // The body was not the published error shape.
  }
  const retryAfter = response.headers.get('Retry-After');
  return {
    status: response.status,
    code,
    message,
    fields,
    retryAfter: retryAfter === null ? null : Number.parseInt(retryAfter, 10),
  };
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  contentType = 'application/json',
): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = contentType;
    payload = contentType === 'application/json' ? JSON.stringify(body) : (body as BodyInit);
  }
  const response = await fetch(path, { method, headers, body: payload });
  if (!response.ok) throw new RequestFailed(await toFailure(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: 'POST', body: form });
  if (!response.ok) throw new RequestFailed(await toFailure(response));
  return (await response.json()) as T;
}

export interface DownloadedFile {
  readonly fileName: string;
}

export async function download(path: string): Promise<DownloadedFile> {
  const response = await fetch(path);
  if (!response.ok) throw new RequestFailed(await toFailure(response));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const fileName = match === null ? 'download' : match[1];
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { fileName };
}

export function get<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}
